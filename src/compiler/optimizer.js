/* @flow */

import { makeMap, isBuiltInTag, cached, no } from 'shared/util'

let isStaticKey
let isPlatformReservedTag

const genStaticKeysCached = cached(genStaticKeys)

/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 */
/**
 * @name optimize
 * @description 优化抽象语法树的方法
 * @description 将抽象语法树中的静态节点抽离出来进行缓存
 *    1. 重新渲染的时候不会再次生成该静态节点
 *    2. 进行节点对比的时候不会对比静态部分
 * @param {ASTElement} root 抽象语法树的根节点
 * @param {CompilerOptions} options 抽象语法树的编译选项
 */
export function optimize(root: ?ASTElement, options: CompilerOptions) {
  // 如果没有传递 ast 对象，则直接返回
  if (!root) return
  // 对所有的静态属性进行缓存
  isStaticKey = genStaticKeysCached(options.staticKeys || '')
  // 获取判断原生标签的方法
  isPlatformReservedTag = options.isReservedTag || no
  // first pass: mark all non-static nodes.
  // 标记语法树中的静态节点
  markStatic(root)
  // second pass: mark static roots.
  // 标记静态根节点
  markStaticRoots(root, false)
}

function genStaticKeys(keys: string): Function {
  return makeMap(
    'type,tag,attrsList,attrsMap,plain,parent,children,attrs,start,end,rawAttrsMap' +
    (keys ? ',' + keys : '')
  )
}

/**
 * @name markStatic
 * @description 标记节点为静态节点
 * @param {ASTNode} node 节点对象
 */
function markStatic(node: ASTNode) {
  // 为节点添加是否静态的标记 static
  node.static = isStatic(node)
  // 如果节点不是元素节点，则直接跳过
  if (node.type === 1) {
    // do not make component slot content static. this avoids
    // 1. components not able to mutate slot nodes
    // 2. static slot content fails for hot-reloading
    // 不会把组件的插槽的内容标记为静态，这样是为了避免两种情况
    // 1. 组件不会及时更新插槽内容
    // 2. 静态插槽无法进行热重载

    // 如果节点是自定义组件，不是 slot ，且没有内联模板时，认为当前节点为非静态节点，并直接返回
    if (
      !isPlatformReservedTag(node.tag) &&
      node.tag !== 'slot' &&
      node.attrsMap['inline-template'] == null
    ) {
      return
    }
    // 循环子节点数组，为每个节点添加是否静态的标记
    for (let i = 0, l = node.children.length; i < l; i++) {
      // 获取直接子节点
      const child = node.children[i]
      // 为子节点添加是否静态的标记
      markStatic(child)
      // 如果直接子节点是非静态的，则为当前节点重新标记为非静态
      if (!child.static) {
        node.static = false
      }
    }
    // 如果节点有 if 条件判断分支，则循环子节点数组，为每个分支节点添加是否静态的标记
    if (node.ifConditions) {
      // 循环子节点数组，为每个分支节点添加是否是静态的标记
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        // 获取分支节点对象
        const block = node.ifConditions[i].block
        // 为分支节点添加是否静态的标记
        markStatic(block)
        // 如果分支节点是非静态的，则标记当前节点为非静态
        if (!block.static) {
          node.static = false
        }
      }
    }
  }
}

function markStaticRoots(node: ASTNode, isInFor: boolean) {
  if (node.type === 1) {
    if (node.static || node.once) {
      node.staticInFor = isInFor
    }
    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    if (node.static && node.children.length && !(
      node.children.length === 1 &&
      node.children[0].type === 3
    )) {
      node.staticRoot = true
      return
    } else {
      node.staticRoot = false
    }
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for)
      }
    }
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor)
      }
    }
  }
}

/**
 * @name isStatic
 * @description 节点是否是静态节点
 * @param {ASTNode} node ast 节点
 * @returns {boolean} 是否是静态节点
 */
function isStatic(node: ASTNode): boolean {
  // 如果节点的类型是表达式节点，则认为不是静态节点
  if (node.type === 2) { // expression
    return false
  }
  // 如果节点的类型是文本节点，则认为是静态节点
  if (node.type === 3) { // text
    return true
  }
  // 满足以下条件，认为是静态节点
  // 1. 使用了 v-pre 跳过编译阶段
  // 2. 同时满足：
  // 2.1 没有使用 v-bind
  // 2.2 没有使用 v-if
  // 2.3 没有使用 v-for
  // 2.4 没有使用 slot / component 标签
  // 2.5 标签名是原生标签，没有使用自定义组件
  // 2.6 父节点标签不是 template 且节点不是 v-for 指令的直接子节点
  // 2.7 节点上没有其他动态属性
  return !!(node.pre || (
    !node.hasBindings && // no dynamic bindings
    !node.if && !node.for && // not v-if or v-for or v-else
    !isBuiltInTag(node.tag) && // not a built-in
    isPlatformReservedTag(node.tag) && // not a component
    !isDirectChildOfTemplateFor(node) &&
    Object.keys(node).every(isStaticKey)
  ))
}

function isDirectChildOfTemplateFor(node: ASTElement): boolean {
  while (node.parent) {
    node = node.parent
    if (node.tag !== 'template') {
      return false
    }
    if (node.for) {
      return true
    }
  }
  return false
}
