/* @flow */

import { genHandlers } from './events'
import baseDirectives from '../directives/index'
import { camelize, no, extend } from 'shared/util'
import { baseWarn, pluckModuleFunction } from '../helpers'
import { emptySlotScopeToken } from '../parser/index'

type TransformFunction = (el: ASTElement, code: string) => string;
type DataGenFunction = (el: ASTElement) => string;
type DirectiveFunction = (el: ASTElement, dir: ASTDirective, warn: Function) => boolean;

/**
 * @name CodegenState
 * @description 代码创建状态
 * @property {CompilerOptions} options 编译选项
 * @property {Function} warn 警告方法
 * @property {TransformFunction[]} transforms 转化代码的方法数组
 * @property {DataGenFunction[]} dataGenFns 生成 data 相关逻辑代码的方法
 * @property {{ [key: string]: DirectiveFunction }} directives 生成指令相关逻辑代码的方法
 * @property {(el: ASTElement) => boolean} maybeComponent 判断是否是自定义组件的方法
 * @property {number} onceId v-once 的 id 编号
 * @property {string[]} staticRenderFns 渲染静态内容的代码数组
 * @property {boolean} pre 当前节点是否使用了 v-pre 指令跳过了编译阶段
 */
export class CodegenState {
  options: CompilerOptions;
  warn: Function;
  transforms: Array<TransformFunction>;
  dataGenFns: Array<DataGenFunction>;
  directives: { [key: string]: DirectiveFunction };
  maybeComponent: (el: ASTElement) => boolean;
  onceId: number;
  staticRenderFns: Array<string>;
  pre: boolean;

  constructor(options: CompilerOptions) {
    this.options = options
    this.warn = options.warn || baseWarn
    this.transforms = pluckModuleFunction(options.modules, 'transformCode')
    this.dataGenFns = pluckModuleFunction(options.modules, 'genData')
    this.directives = extend(extend({}, baseDirectives), options.directives)
    const isReservedTag = options.isReservedTag || no
    this.maybeComponent = (el: ASTElement) => !!el.component || !isReservedTag(el.tag)
    this.onceId = 0
    this.staticRenderFns = []
    this.pre = false
  }
}

export type CodegenResult = {
  render: string,
  staticRenderFns: Array<string>
};

/**
 * @name generate
 * @description 根据 ast 对象生成 js 代码
 * @param {ASTElement} ast 抽象语法树节点
 * @param {CompilerOptions} options 编译选项
 * @returns {CodegenResult} 生成的 js 代码
 */
export function generate(
  ast: ASTElement | void,
  options: CompilerOptions
): CodegenResult {
  // 创建代码生成过程中的状态对象
  const state = new CodegenState(options)
  // fix #11483, Root level <script> tags should not be rendered.
  // 创建代码片段
  // 如果 ast 对象不存在，则直接返回创建空 div 元素的代码
  // 否则根据元素标签名称生成对应的代码
  // 如果元素标签名是 script ，则返回 null 空内容，否则根据元素标签名称生成对应的代码
  const code = ast ? (ast.tag === 'script' ? 'null' : genElement(ast, state)) : '_c("div")'
  // 返回代码片段
  return {
    render: `with(this){return ${code}}`,
    staticRenderFns: state.staticRenderFns
  }
}

/**
 * @name genElement
 * @description 生成元素代码的方法
 * @param {ASTElement} el 元素 ast
 * @param {CodegenState} state 生成代码过程中的状态对象
 * @returns {string} 代码模板
 */
export function genElement(el: ASTElement, state: CodegenState): string {
  // 如果节点有父节点，节点 pre 的取值是本身 pre 属性与父节点 pre 属性的并集
  if (el.parent) {
    el.pre = el.pre || el.parent.pre
  }

  // 如果当前节点是静态根节点且没有被处理过，则生成静态节点代码并返回
  if (el.staticRoot && !el.staticProcessed) {
    return genStatic(el, state)
  }
  // 如果当前节点使用了 v-once 且没有被处理过，则生成只渲染一次的节点代码并返回
  else if (el.once && !el.onceProcessed) {
    return genOnce(el, state)
  }
  // 如果当前节点使用了 v-for 且没有被处理过，则生成循环渲染的代码并返回
  else if (el.for && !el.forProcessed) {
    return genFor(el, state)
  }
  // 如果当前节点使用了 v-if 且没有被处理过，则生成条件渲染的代码并返回
  else if (el.if && !el.ifProcessed) {
    return genIf(el, state)
  }
  // 如果当前节点的标签名是 template 、不是插槽节点也没有使用 v-pre ，则生成子节点渲染代码或空节点代码并返回
  else if (el.tag === 'template' && !el.slotTarget && !state.pre) {
    return genChildren(el, state) || 'void 0'
  }
  // 如果当前节点是插槽，则生成插槽渲染代码并返回
  else if (el.tag === 'slot') {
    return genSlot(el, state)
  }
  // 否则按照一般渲染代码生成方法生成代码
  else {
    // component or element
    /** @const {string} code 渲染代码 */
    let code
    // 如果节点是自定义组件元素，则生成自定义组件渲染代码
    if (el.component) {
      code = genComponent(el.component, el, state)
    }
    // 否则按照渲染普通元素的方法生成渲染代码
    else {
      /** @const {string} data 渲染 data 的代码 */
      let data
      // 如果节点不是空节点或者有可能是自定义组件且使用了 v-pre 时，生成渲染属性的代码
      if (!el.plain || (el.pre && state.maybeComponent(el))) {
        data = genData(el, state)
      }

      // 如果节点没有内联模板的话，生成渲染子节点的代码
      const children = el.inlineTemplate ? null : genChildren(el, state, true)
      // 生成渲染节点的代码，_c = (a, b, c, d) => createElement(vm, a, b, c, d, false)
      code = `_c('${el.tag}'${data ? `,${data}` : '' // data
        }${children ? `,${children}` : '' // children
        })`
    }
    // module transforms
    // 调用代码转化方法转化生成的代码
    for (let i = 0; i < state.transforms.length; i++) {
      code = state.transforms[i](el, code)
    }
    // 返回生成的代码片段
    return code
  }
}

// hoist static sub-trees out
function genStatic(el: ASTElement, state: CodegenState): string {
  el.staticProcessed = true
  // Some elements (templates) need to behave differently inside of a v-pre
  // node.  All pre nodes are static roots, so we can use this as a location to
  // wrap a state change and reset it upon exiting the pre node.
  const originalPreState = state.pre
  if (el.pre) {
    state.pre = el.pre
  }
  state.staticRenderFns.push(`with(this){return ${genElement(el, state)}}`)
  state.pre = originalPreState
  return `_m(${state.staticRenderFns.length - 1
    }${el.staticInFor ? ',true' : ''
    })`
}

// v-once
function genOnce(el: ASTElement, state: CodegenState): string {
  el.onceProcessed = true
  if (el.if && !el.ifProcessed) {
    return genIf(el, state)
  } else if (el.staticInFor) {
    let key = ''
    let parent = el.parent
    while (parent) {
      if (parent.for) {
        key = parent.key
        break
      }
      parent = parent.parent
    }
    if (!key) {
      process.env.NODE_ENV !== 'production' && state.warn(
        `v-once can only be used inside v-for that is keyed. `,
        el.rawAttrsMap['v-once']
      )
      return genElement(el, state)
    }
    return `_o(${genElement(el, state)},${state.onceId++},${key})`
  } else {
    return genStatic(el, state)
  }
}

export function genIf(
  el: any,
  state: CodegenState,
  altGen?: Function,
  altEmpty?: string
): string {
  el.ifProcessed = true // avoid recursion
  return genIfConditions(el.ifConditions.slice(), state, altGen, altEmpty)
}

function genIfConditions(
  conditions: ASTIfConditions,
  state: CodegenState,
  altGen?: Function,
  altEmpty?: string
): string {
  if (!conditions.length) {
    return altEmpty || '_e()'
  }

  const condition = conditions.shift()
  if (condition.exp) {
    return `(${condition.exp})?${genTernaryExp(condition.block)
      }:${genIfConditions(conditions, state, altGen, altEmpty)
      }`
  } else {
    return `${genTernaryExp(condition.block)}`
  }

  // v-if with v-once should generate code like (a)?_m(0):_m(1)
  function genTernaryExp(el) {
    return altGen
      ? altGen(el, state)
      : el.once
        ? genOnce(el, state)
        : genElement(el, state)
  }
}

export function genFor(
  el: any,
  state: CodegenState,
  altGen?: Function,
  altHelper?: string
): string {
  const exp = el.for
  const alias = el.alias
  const iterator1 = el.iterator1 ? `,${el.iterator1}` : ''
  const iterator2 = el.iterator2 ? `,${el.iterator2}` : ''

  if (process.env.NODE_ENV !== 'production' &&
    state.maybeComponent(el) &&
    el.tag !== 'slot' &&
    el.tag !== 'template' &&
    !el.key
  ) {
    state.warn(
      `<${el.tag} v-for="${alias} in ${exp}">: component lists rendered with ` +
      `v-for should have explicit keys. ` +
      `See https://vuejs.org/guide/list.html#key for more info.`,
      el.rawAttrsMap['v-for'],
      true /* tip */
    )
  }

  el.forProcessed = true // avoid recursion
  return `${altHelper || '_l'}((${exp}),` +
    `function(${alias}${iterator1}${iterator2}){` +
    `return ${(altGen || genElement)(el, state)}` +
    '})'
}

/**
 * @name genData
 * @description 生成渲染节点属性的方法
 * @param {ASTElement} el ast 节点
 * @param {CodegenState} state 代码生成状态对象
 * @returns {string} 属性渲染代码
 */
export function genData(el: ASTElement, state: CodegenState): string {
  // 初始化属性对象字符串
  let data = '{'

  // directives first.
  // directives may mutate the el's other properties before they are generated.
  // 添加指令渲染代码
  const dirs = genDirectives(el, state)
  if (dirs) data += dirs + ','

  // key
  // 添加 key 属性渲染代码
  if (el.key) {
    data += `key:${el.key},`
  }
  // ref
  // 添加 ref 属性渲染代码
  if (el.ref) {
    data += `ref:${el.ref},`
  }
  // 添加 refInFor 属性渲染代码
  if (el.refInFor) {
    data += `refInFor:true,`
  }
  // pre
  // 添加 pre 属性渲染代码
  if (el.pre) {
    data += `pre:true,`
  }
  // record original tag name for components using "is" attribute
  // 如果节点是自定义组件节点，则添加 tag 属性渲染代码
  if (el.component) {
    data += `tag:"${el.tag}",`
  }
  // module data generation functions
  // 为节点添加 data 的渲染代码
  for (let i = 0; i < state.dataGenFns.length; i++) {
    data += state.dataGenFns[i](el)
  }
  // attributes
  // 为节点添加 attrs 的渲染代码
  if (el.attrs) {
    data += `attrs:${genProps(el.attrs)},`
  }
  // DOM props
  // 为节点添加 domProps 的渲染代码
  if (el.props) {
    data += `domProps:${genProps(el.props)},`
  }
  // event handlers
  // 为节点添加合成事件处理的渲染代码
  if (el.events) {
    data += `${genHandlers(el.events, false)},`
  }
  // 为节点添加原生事件处理的渲染代码
  if (el.nativeEvents) {
    data += `${genHandlers(el.nativeEvents, true)},`
  }
  // slot target
  // only for non-scoped slots
  // 为节点添加 slot 的渲染代码
  if (el.slotTarget && !el.slotScope) {
    data += `slot:${el.slotTarget},`
  }
  // scoped slots
  // 为节点添加 scope slot 的渲染代码
  if (el.scopedSlots) {
    data += `${genScopedSlots(el, el.scopedSlots, state)},`
  }
  // component v-model
  // 为节点添加 v-model 的渲染代码
  if (el.model) {
    data += `model:{value:${el.model.value
      },callback:${el.model.callback
      },expression:${el.model.expression
      }},`
  }
  // inline-template
  // 如果节点存在内联模板，则为节点添加内联模板的渲染代码
  if (el.inlineTemplate) {
    const inlineTemplate = genInlineTemplate(el, state)
    if (inlineTemplate) {
      data += `${inlineTemplate},`
    }
  }
  // 去除掉 data 对象的最后一个逗号
  data = data.replace(/,$/, '') + '}'
  // v-bind dynamic argument wrap
  // v-bind with dynamic arguments must be applied using the same v-bind object
  // merge helper so that class/style/mustUseProp attrs are handled correctly.
  // 如果节点使用了 v-bind 绑定了动态参数，
  // 则该动态参数必须被保留到生成的渲染代码中，以防止 class/style/mustUseProp 等属性的渲染出错
  if (el.dynamicAttrs) {
    data = `_b(${data},"${el.tag}",${genProps(el.dynamicAttrs)})`
  }
  // v-bind data wrap
  // 如果节点使用了 v-bind ，则将节点的属性渲染代码重新生成
  if (el.wrapData) {
    data = el.wrapData(data)
  }
  // v-on data wrap
  // 如果节点使用了 v-bind， 则将节点的监听渲染代码重新生成
  if (el.wrapListeners) {
    data = el.wrapListeners(data)
  }
  // 返回属性渲染代码
  return data
}

function genDirectives(el: ASTElement, state: CodegenState): string | void {
  const dirs = el.directives
  if (!dirs) return
  let res = 'directives:['
  let hasRuntime = false
  let i, l, dir, needRuntime
  for (i = 0, l = dirs.length; i < l; i++) {
    dir = dirs[i]
    needRuntime = true
    const gen: DirectiveFunction = state.directives[dir.name]
    if (gen) {
      // compile-time directive that manipulates AST.
      // returns true if it also needs a runtime counterpart.
      needRuntime = !!gen(el, dir, state.warn)
    }
    if (needRuntime) {
      hasRuntime = true
      res += `{name:"${dir.name}",rawName:"${dir.rawName}"${dir.value ? `,value:(${dir.value}),expression:${JSON.stringify(dir.value)}` : ''
        }${dir.arg ? `,arg:${dir.isDynamicArg ? dir.arg : `"${dir.arg}"`}` : ''
        }${dir.modifiers ? `,modifiers:${JSON.stringify(dir.modifiers)}` : ''
        }},`
    }
  }
  if (hasRuntime) {
    return res.slice(0, -1) + ']'
  }
}

function genInlineTemplate(el: ASTElement, state: CodegenState): ?string {
  const ast = el.children[0]
  if (process.env.NODE_ENV !== 'production' && (
    el.children.length !== 1 || ast.type !== 1
  )) {
    state.warn(
      'Inline-template components must have exactly one child element.',
      { start: el.start }
    )
  }
  if (ast && ast.type === 1) {
    const inlineRenderFns = generate(ast, state.options)
    return `inlineTemplate:{render:function(){${inlineRenderFns.render
      }},staticRenderFns:[${inlineRenderFns.staticRenderFns.map(code => `function(){${code}}`).join(',')
      }]}`
  }
}

function genScopedSlots(
  el: ASTElement,
  slots: { [key: string]: ASTElement },
  state: CodegenState
): string {
  // by default scoped slots are considered "stable", this allows child
  // components with only scoped slots to skip forced updates from parent.
  // but in some cases we have to bail-out of this optimization
  // for example if the slot contains dynamic names, has v-if or v-for on them...
  let needsForceUpdate = el.for || Object.keys(slots).some(key => {
    const slot = slots[key]
    return (
      slot.slotTargetDynamic ||
      slot.if ||
      slot.for ||
      containsSlotChild(slot) // is passing down slot from parent which may be dynamic
    )
  })

  // #9534: if a component with scoped slots is inside a conditional branch,
  // it's possible for the same component to be reused but with different
  // compiled slot content. To avoid that, we generate a unique key based on
  // the generated code of all the slot contents.
  let needsKey = !!el.if

  // OR when it is inside another scoped slot or v-for (the reactivity may be
  // disconnected due to the intermediate scope variable)
  // #9438, #9506
  // TODO: this can be further optimized by properly analyzing in-scope bindings
  // and skip force updating ones that do not actually use scope variables.
  if (!needsForceUpdate) {
    let parent = el.parent
    while (parent) {
      if (
        (parent.slotScope && parent.slotScope !== emptySlotScopeToken) ||
        parent.for
      ) {
        needsForceUpdate = true
        break
      }
      if (parent.if) {
        needsKey = true
      }
      parent = parent.parent
    }
  }

  const generatedSlots = Object.keys(slots)
    .map(key => genScopedSlot(slots[key], state))
    .join(',')

  return `scopedSlots:_u([${generatedSlots}]${needsForceUpdate ? `,null,true` : ``
    }${!needsForceUpdate && needsKey ? `,null,false,${hash(generatedSlots)}` : ``
    })`
}

function hash(str) {
  let hash = 5381
  let i = str.length
  while (i) {
    hash = (hash * 33) ^ str.charCodeAt(--i)
  }
  return hash >>> 0
}

function containsSlotChild(el: ASTNode): boolean {
  if (el.type === 1) {
    if (el.tag === 'slot') {
      return true
    }
    return el.children.some(containsSlotChild)
  }
  return false
}

function genScopedSlot(
  el: ASTElement,
  state: CodegenState
): string {
  const isLegacySyntax = el.attrsMap['slot-scope']
  if (el.if && !el.ifProcessed && !isLegacySyntax) {
    return genIf(el, state, genScopedSlot, `null`)
  }
  if (el.for && !el.forProcessed) {
    return genFor(el, state, genScopedSlot)
  }
  const slotScope = el.slotScope === emptySlotScopeToken
    ? ``
    : String(el.slotScope)
  const fn = `function(${slotScope}){` +
    `return ${el.tag === 'template'
      ? el.if && isLegacySyntax
        ? `(${el.if})?${genChildren(el, state) || 'undefined'}:undefined`
        : genChildren(el, state) || 'undefined'
      : genElement(el, state)
    }}`
  // reverse proxy v-slot without scope on this.$slots
  const reverseProxy = slotScope ? `` : `,proxy:true`
  return `{key:${el.slotTarget || `"default"`},fn:${fn}${reverseProxy}}`
}

/**
 * @name genChildren
 * @description 生成渲染子节点代码的方法
 * @param {ASTElement} el 节点 ast 对象
 * @param {CodegenState} state 代码生成状态
 * @param {boolean} checkSkip 进行节点规范化检查
 * @param {Function} altGenElement 生成渲染元素代码的方法
 * @param {Function} altGenNode 生成渲染节点代码的方法
 * @returns {string} 渲染子节点的代码片段
 */
export function genChildren(
  el: ASTElement,
  state: CodegenState,
  checkSkip?: boolean,
  altGenElement?: Function,
  altGenNode?: Function
): string | void {
  // 获取子节点数组
  const children = el.children
  // 如果子节点数组长为空，则直接返回
  if (children.length) {
    /** @const {any} el 第一个子节点  */
    const el: any = children[0]
    // optimize single v-for
    // 如果只有一个非 template 或 slot 的子节点，且使用了 v-for 指令，
    // 则直接返回根据子节点生成的渲染代码
    if (children.length === 1 &&
      el.for &&
      el.tag !== 'template' &&
      el.tag !== 'slot'
    ) {
      // 获取节点规范化类型
      // 如果要进行节点规范化检查，则根据节点是否是自定义组件决定类型是 1 还是 0
      // 否则规范化类型为空
      const normalizationType = checkSkip
        ? state.maybeComponent(el) ? `,1` : `,0`
        : ``
      // 优先使用作为参数的元素渲染代码生成方法，其次使用 genElement 生成元素渲染代码
      // 返回代码片段
      return `${(altGenElement || genElement)(el, state)}${normalizationType}`
    }
    // 获取节点规范化类型
    // 如果要进行节点规范化检查，则根据节点特性获得规范化类型
    // 否则规范化类型为0
    const normalizationType = checkSkip
      ? getNormalizationType(children, state.maybeComponent)
      : 0
    // 优先从参数中获取生成节点渲染的代码，其次使用 genNode 方法
    const gen = altGenNode || genNode
    // 生成节点渲染的代码
    return `[${children.map(c => gen(c, state)).join(',')}]${normalizationType ? `,${normalizationType}` : ''}`
  }
}

// determine the normalization needed for the children array.
// 0: no normalization needed
// 1: simple normalization needed (possible 1-level deep nested array)
// 2: full normalization needed
function getNormalizationType(
  children: Array<ASTNode>,
  maybeComponent: (el: ASTElement) => boolean
): number {
  let res = 0
  for (let i = 0; i < children.length; i++) {
    const el: ASTNode = children[i]
    if (el.type !== 1) {
      continue
    }
    if (needsNormalization(el) ||
      (el.ifConditions && el.ifConditions.some(c => needsNormalization(c.block)))) {
      res = 2
      break
    }
    if (maybeComponent(el) ||
      (el.ifConditions && el.ifConditions.some(c => maybeComponent(c.block)))) {
      res = 1
    }
  }
  return res
}

function needsNormalization(el: ASTElement): boolean {
  return el.for !== undefined || el.tag === 'template' || el.tag === 'slot'
}

/**
 * @name genNode
 * @description 生成节点渲染代码的方法
 * @param {ASTNode} node 节点 ast
 * @param {CodegenState} state 生成渲染代码时的状态
 * @returns {string} 节点渲染代码
 */
function genNode(node: ASTNode, state: CodegenState): string {
  // 如果是元素节点，则调用 genElement 生成元素渲染代码并返回
  if (node.type === 1) {
    return genElement(node, state)
  }
  // 如果是注释节点，则调用 genComment 生成注释渲染代码并返回
  else if (node.type === 3 && node.isComment) {
    return genComment(node)
  }
  // 否则生成文本渲染代码并返回
  else {
    return genText(node)
  }
}

/**
 * @name genText
 * @description 生成渲染文本节点代码的方法
 * @param {ASTText|ASTExpression} text 文本节点或表达式节点
 * @returns {string} 文本渲染代码
 */
export function genText(text: ASTText | ASTExpression): string {
  // 如果节点类型是表达式，则根据表达式代码生成渲染代码
  // 如果节点类型是文本，则先将文本内容序列化，然后再处理内容中的特殊换行，
  // 根据处理后的文本内容生成文本节点，并返回
  // _v => createTextVNode
  return `_v(${text.type === 2
    ? text.expression // no need for () because already wrapped in _s()
    : transformSpecialNewlines(JSON.stringify(text.text))
    })`
}

/**
 * @name genComment
 * @description 生成注释渲染代码
 * @param {ASTText} comment 注释节点
 * @returns {string} 注释渲染代码
 */
export function genComment(comment: ASTText): string {
  // 将注释内容序列化：hello => "hello"
  // 返回渲染注释节点的代码片段，_e => createEmptyVNode
  return `_e(${JSON.stringify(comment.text)})`
}

function genSlot(el: ASTElement, state: CodegenState): string {
  const slotName = el.slotName || '"default"'
  const children = genChildren(el, state)
  let res = `_t(${slotName}${children ? `,function(){return ${children}}` : ''}`
  const attrs = el.attrs || el.dynamicAttrs
    ? genProps((el.attrs || []).concat(el.dynamicAttrs || []).map(attr => ({
      // slot props are camelized
      name: camelize(attr.name),
      value: attr.value,
      dynamic: attr.dynamic
    })))
    : null
  const bind = el.attrsMap['v-bind']
  if ((attrs || bind) && !children) {
    res += `,null`
  }
  if (attrs) {
    res += `,${attrs}`
  }
  if (bind) {
    res += `${attrs ? '' : ',null'},${bind}`
  }
  return res + ')'
}

// componentName is el.component, take it as argument to shun flow's pessimistic refinement
function genComponent(
  componentName: string,
  el: ASTElement,
  state: CodegenState
): string {
  const children = el.inlineTemplate ? null : genChildren(el, state, true)
  return `_c(${componentName},${genData(el, state)}${children ? `,${children}` : ''
    })`
}

function genProps(props: Array<ASTAttr>): string {
  let staticProps = ``
  let dynamicProps = ``
  for (let i = 0; i < props.length; i++) {
    const prop = props[i]
    const value = __WEEX__
      ? generateValue(prop.value)
      : transformSpecialNewlines(prop.value)
    if (prop.dynamic) {
      dynamicProps += `${prop.name},${value},`
    } else {
      staticProps += `"${prop.name}":${value},`
    }
  }
  staticProps = `{${staticProps.slice(0, -1)}}`
  if (dynamicProps) {
    return `_d(${staticProps},[${dynamicProps.slice(0, -1)}])`
  } else {
    return staticProps
  }
}

/* istanbul ignore next */
function generateValue(value) {
  if (typeof value === 'string') {
    return transformSpecialNewlines(value)
  }
  return JSON.stringify(value)
}

// #3895, #4268
function transformSpecialNewlines(text: string): string {
  return text
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
