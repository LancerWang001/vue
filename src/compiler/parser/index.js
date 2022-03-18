/* @flow */

import he from 'he'
import { parseHTML } from './html-parser'
import { parseText } from './text-parser'
import { parseFilters } from './filter-parser'
import { genAssignmentCode } from '../directives/model'
import { extend, cached, no, camelize, hyphenate } from 'shared/util'
import { isIE, isEdge, isServerRendering } from 'core/util/env'

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  getRawBindingAttr,
  pluckModuleFunction,
  getAndRemoveAttrByRegex
} from '../helpers'

// 事件绑定正则
export const onRE = /^@|^v-on:/
// 指令正则
export const dirRE = process.env.VBIND_PROP_SHORTHAND
  ? /^v-|^@|^:|^\.|^#/
  : /^v-|^@|^:|^#/
// for循环 in / of 关键字正则表达式
export const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/
// for循环迭代器正则
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
// 括号正则
const stripParensRE = /^\(|\)$/g
// 动态参数正则
const dynamicArgRE = /^\[.*\]$/

// 指令参数正则
const argRE = /:(.*)$/
// v-bind正则
export const bindRE = /^:|^\.|^v-bind:/

// 绑定属性正则
const propBindRE = /^\./
// 属性修饰符正则
const modifierRE = /\.[^.\]]+(?=[^\]]*$)/g

// v-slot插槽正则 v-slot / v-slot: / #
const slotRE = /^v-slot(:|$)|^#/

// 换行正则
const lineBreakRE = /[\r\n]/
// 空字符正则
const whitespaceRE = /[ \f\t\r\n]+/g

// 非法属性字符正则
const invalidAttributeRE = /[\s"'<>\/=]/

// 解码html转义符的方法
const decodeHTMLCached = cached(he.decode)

// 空插槽token
export const emptySlotScopeToken = `_empty_`

// configurable state
// 配置状态
// 警告方法
export let warn: any
// 差值表达式标识符，默认为{{}}
let delimiters
// 将标签上的`props`、`class`、`style`属性转化为 ast 属性对象
let transforms
// 处理input标签的v-model和type属性，将逻辑转化为 ast 对象
let preTransforms
// 处理weex标签的属性，并转化为 ast 对象
let postTransforms
// 判断是否是 pre 标签的方法
let platformIsPreTag
// 判断是否使用绑定属性的方法
let platformMustUseProp
// 获取标签命名空间的方法
let platformGetTagNamespace
// 判断是否是Vue组件的方法
let maybeComponent

/**
 * @name createASTElement
 * @description 创建 AST 元素的方法
 * @param {string} tag 标签名
 * @param {ASTAttr[]} attrs 属性集合
 * @param {ASTElement} parent 父级 AST 元素
 * @returns {ASTElement} 返回 AST 元素
 */
export function createASTElement(
  tag: string,
  attrs: Array<ASTAttr>,
  parent: ASTElement | void
): ASTElement {
  return {
    type: 1, // 元素类型
    tag, // 标签名
    attrsList: attrs, // 标签属性列表
    attrsMap: makeAttrsMap(attrs), // 标签属性映射（只保存字符串值）
    rawAttrsMap: {}, // 标签属性映射（保存属性对象）
    parent, // 父级元素 AST
    children: [] // 子元素 AST 集合
  }
}

/**
 * Convert HTML string to AST.
 */
/**
 * @name parse
 * @description 将模板转化为 ast
 * @param {string} template 模板字符串
 * @param {Object} options 解析参数
 * @returns {ASTElement} ast 元素
 */
export function parse(
  template: string,
  options: CompilerOptions
): ASTElement | void {
  // 获取警告方法
  warn = options.warn || baseWarn
  // 获取判断是否是 pre 标签的方法
  platformIsPreTag = options.isPreTag || no
  // 获取判断是否使用绑定属性的方法
  platformMustUseProp = options.mustUseProp || no
  // 获取查询标签命名空间的方法
  platformGetTagNamespace = options.getTagNamespace || no
  // 获取判断是否是内置标签的方法
  const isReservedTag = options.isReservedTag || no
  // 获取判断标签是否是组件的方法
  maybeComponent = (el: ASTElement) => !!(
    el.component ||
    el.attrsMap[':is'] ||
    el.attrsMap['v-bind:is'] ||
    !(el.attrsMap.is ? isReservedTag(el.attrsMap.is) : isReservedTag(el.tag))
  )
  // 获取解析标签属性的方法集合
  transforms = pluckModuleFunction(options.modules, 'transformNode')
  // 获取解析 input 标签属性的方法集合
  preTransforms = pluckModuleFunction(options.modules, 'preTransformNode')
  // 获取解析 weex 标签属性的方法集合
  postTransforms = pluckModuleFunction(options.modules, 'postTransformNode')

  // 从解析参数中获取差值表达式标识符
  delimiters = options.delimiters

  // 创建双标签解析栈，保存双标签的 ast 元素
  const stack = []
  // 获取是否使用内置空行的标识（' '）
  const preserveWhitespace = options.preserveWhitespace !== false
  // 获取空行选项
  const whitespaceOption = options.whitespace
  // 声明根节点元素 ast
  let root
  // 声明当前父节点元素 ast
  let currentParent
  // 当前节点是否不需要编译（v-pre）
  let inVPre = false
  // 是否是 pre 标签
  let inPre = false
  // 是否已经警告过
  let warned = false

  /**
   * @name warnOnce
   * @description 只进行一次警告
   * @param {string} msg 警告信息 
   * @param {Range} range 在模板字符串中的位置范围
   */
  function warnOnce(msg, range) {
    // 如果已经警告过，则直接跳过
    if (!warned) {
      // 将警告标识（`warned`）置为 true
      warned = true
      // 提示警告信息
      warn(msg, range)
    }
  }

  /**
   * @name closeElement
   * @description 闭合标签的方法
   * @param {ASTElement} element 标签的 ast 元素
   */
  function closeElement(element) {
    // 去除标签节点尾部的空节点
    trimEndingWhitespace(element)
    // 如果标签节点不在 v-pre 指令中且节点标签不是 input ，则处理标签中的指令和属性
    if (!inVPre && !element.processed) {
      element = processElement(element, options)
    }
    // tree management
    // 如果标签栈已经清空且当前元素不是根元素，则判断是否在根元素使用了 v-if / v-else-if 的分支逻辑
    if (!stack.length && element !== root) {
      // allow root elements with v-if, v-else-if and v-else
      // 如果在根元素中使用了 v-if / v-else-if 的分支逻辑，则为根元素添加分支判断语句
      if (root.if && (element.elseif || element.else)) {
        // 在开发环境中检查根元素是否为合法元素
        if (process.env.NODE_ENV !== 'production') {
          checkRootConstraints(element)
        }
        // 为根元素添加分支判断语句
        addIfCondition(root, {
          exp: element.elseif,
          block: element
        })
      }
      // 如果根元素没有使用分支判断语句，且当前元素不是根元素的话，则在开发环境中提示警告信息
      else if (process.env.NODE_ENV !== 'production') {
        warnOnce(
          `Component template should contain exactly one root element. ` +
          `If you are using v-if on multiple elements, ` +
          `use v-else-if to chain them instead.`,
          { start: element.start }
        )
      }
    }
    // 如果当前父节点元素存在且当前节点元素非禁用元素，则将当前节点元素插入节点树中
    if (currentParent && !element.forbidden) {
      // 如果元素中存在 else if / else 的分支判断，则为上一个节点元素添加 else if / else 的分支判断
      if (element.elseif || element.else) {
        processIfConditions(element, currentParent)
      }
      // 如果元素没有分支判断，则将元素插入节点树中
      else {
        // 如果元素是插槽元素，则将元素存入父节点元素的插槽中
        if (element.slotScope) {
          // scoped slot
          // keep it in the children list so that v-else(-if) conditions can
          // find it as the prev node.
          /** @const {string} name 插槽名 */
          const name = element.slotTarget || '"default"';
          // 将元素存入父节点元素的插槽中
          (currentParent.scopedSlots || (currentParent.scopedSlots = {}))[name] = element
        }
        // 将元素存入父节点元素的子节点数组中
        currentParent.children.push(element)
        // 将元素的父节点指针指向当前父节点
        element.parent = currentParent
      }
    }

    // final children cleanup
    // filter out scoped slots
    // 将当前节点元素的子节点元素中作为插槽元素的子节点过滤掉
    element.children = element.children.filter(c => !(c: any).slotScope)
    // remove trailing whitespace node again
    // 再次清除元素末尾的空白文本节点
    trimEndingWhitespace(element)

    // check pre state
    // 重置 inVPre 变量为 false
    if (element.pre) {
      inVPre = false
    }
    // 重置 inPre 变量为 false
    if (platformIsPreTag(element.tag)) {
      inPre = false
    }
    // apply post-transforms
    // 调用 post-transforms 转化，处理 weex 标签元素
    for (let i = 0; i < postTransforms.length; i++) {
      postTransforms[i](element, options)
    }
  }

  /**
   * @name trimEndingWhitespace
   * @description 去除标签子节点尾部的空节点
   * @param {ASTElement} el 标签子节点 ast 元素
   */
  function trimEndingWhitespace(el) {
    // remove trailing whitespace node
    // 如果是 pre 标签，则直接跳过
    if (!inPre) {
      // 从标签子节点的最后一个节点开始，向前遍历，如果是文本节点，且文本内容是空，则删除该子节点
      let lastNode
      while (
        (lastNode = el.children[el.children.length - 1]) &&
        lastNode.type === 3 &&
        lastNode.text === ' '
      ) {
        el.children.pop()
      }
    }
  }

  /**
   * @name checkRootConstraints
   * @description 检查根节点 ast 元素
   * @param {ASTElement} el 根节点 ast 元素
   */
  function checkRootConstraints(el) {
    // 根节点标签不能是 `slot` 或 `template`
    if (el.tag === 'slot' || el.tag === 'template') {
      warnOnce(
        `Cannot use <${el.tag}> as component root element because it may ` +
        'contain multiple nodes.',
        { start: el.start }
      )
    }
    // 根节点不能使用 `v-for` 指令
    if (el.attrsMap.hasOwnProperty('v-for')) {
      warnOnce(
        'Cannot use v-for on stateful component root element because ' +
        'it renders multiple elements.',
        el.rawAttrsMap['v-for']
      )
    }
  }

  // 解析模板字符串
  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    isUnaryTag: options.isUnaryTag,
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,
    outputSourceRange: options.outputSourceRange,
    /**
     * @name start
     * @description 解析开始标签
     * @param {string} tag 开始标签名
     * @param {ASTAttr[]} attrs 标签属性列表
     * @param {boolean} unary 是否是单标签
     * @param {number} start 开始标签解析起始位置
     * @param {number} end 开始标签解析结束位置
     */
    start(tag, attrs, unary, start, end) {
      // check namespace.
      // inherit parent ns if there is one
      // 获取当前标签的命名空间（svg、math标签特有）
      const ns = (currentParent && currentParent.ns) || platformGetTagNamespace(tag)

      // handle IE svg bug
      /* istanbul ignore if */
      // 如果平台是 ie 浏览器且命名空间是 svg ，则特殊处理 ie 的中存在的 bug
      if (isIE && ns === 'svg') {
        attrs = guardIESVGBug(attrs)
      }

      // 创建开始标签节点
      let element: ASTElement = createASTElement(tag, attrs, currentParent)
      // 如果存在标签命名空间，则为标签添加此命名空间
      if (ns) {
        element.ns = ns
      }

      // 在开发环境中添加、校验节点属性
      if (process.env.NODE_ENV !== 'production') {
        // 如果配置了 outputSourceRange 选项的话，为节点添加解析开始位置和结束位置以及格式化的属性映射
        if (options.outputSourceRange) {
          element.start = start
          element.end = end
          element.rawAttrsMap = element.attrsList.reduce((cumulated, attr) => {
            cumulated[attr.name] = attr
            return cumulated
          }, {})
        }
        // 校验属性名称是否合法
        attrs.forEach(attr => {
          if (invalidAttributeRE.test(attr.name)) {
            warn(
              `Invalid dynamic argument expression: attribute names cannot contain ` +
              `spaces, quotes, <, >, / or =.`,
              {
                start: attr.start + attr.name.indexOf(`[`),
                end: attr.start + attr.name.length
              }
            )
          }
        })
      }

      // 如果使用了被禁用的标签或者正在进行服务端渲染，则将节点标注为禁用，且在开发环境中给出警示
      if (isForbiddenTag(element) && !isServerRendering()) {
        // 将节点标注为禁用
        element.forbidden = true
        // 在开发环境中进行警示
        process.env.NODE_ENV !== 'production' && warn(
          'Templates should only be responsible for mapping the state to the ' +
          'UI. Avoid placing tags with side-effects in your templates, such as ' +
          `<${tag}>` + ', as they will not be parsed.',
          { start: element.start }
        )
      }

      // apply pre-transforms
      // 处理 input 标签上的 v-mdel 等属性，并将处理逻辑解析为 ast 挂载到节点
      for (let i = 0; i < preTransforms.length; i++) {
        element = preTransforms[i](element, options) || element
      }

      // 处理节点上的 v-pre 指令
      if (!inVPre) {
        processPre(element)
        if (element.pre) {
          inVPre = true
        }
      }
      // 处理 pre 标签
      if (platformIsPreTag(element.tag)) {
        inPre = true
      }

      // 如果标签属性中有 v-pre 指令，则为节点添加序列化之后的属性列表
      if (inVPre) {
        processRawAttrs(element)
      }
      // 如果标签属性中没有 v-pre 指令且没有被处理过，则处理标签中处理结构化的指令
      else if (!element.processed) {
        // structural directives
        // 处理 v-for 指令
        processFor(element)
        // 处理 v-if 指令
        processIf(element)
        // 处理 v-once 指令
        processOnce(element)
      }

      // 如果当前没有根节点，则将当前节点作为根节点，并在开发环境中检查根节点是否合法
      if (!root) {
        root = element
        if (process.env.NODE_ENV !== 'production') {
          checkRootConstraints(root)
        }
      }

      // 如果当前节点不是单标签节点，则将当前节点作为当前父节点
      if (!unary) {
        // 将当前节点作为当前父节点
        currentParent = element
        // 将当前节点压入开始节点栈
        stack.push(element)
      }
      // 如果是单标签节点，直接结束当前节点解析过程
      else {
        closeElement(element)
      }
    },

    /**
     * @description 解析结束标签
     * @name end
     * @param {string} tag 开始标签名
     * @param {number} start 结束标签开始位置
     * @param {number} end 结束标签结束位置
     */
    end(tag, start, end) {
      /** @const {ASTElement} element 当前开始标签节点 */
      const element = stack[stack.length - 1]
      // pop stack
      // 将当前开始标签节点从节点栈中弹出
      stack.length -= 1
      // 重置当前父节点
      currentParent = stack[stack.length - 1]
      // 在开发环境中如果设置了 outputSourceRange 选项，则为节点添加 end 指针
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        element.end = end
      }
      // 结束当前标签节点解析解析过程
      closeElement(element)
    },

    /**
     * @name chars
     * @description 解析文本内容
     * @param {string} text 文本内容
     * @param {number} start 文本内容开始位置
     * @param {number} end 文本内容结束位置
     */
    chars(text: string, start: number, end: number) {
      // 如果当前父节点元素不存在，则在开发环境提示警告信息并直接返回
      if (!currentParent) {
        if (process.env.NODE_ENV !== 'production') {
          if (text === template) {
            warnOnce(
              'Component template requires a root element, rather than just text.',
              { start }
            )
          } else if ((text = text.trim())) {
            warnOnce(
              `text "${text}" outside root element will be ignored.`,
              { start }
            )
          }
        }
        return
      }
      // IE textarea placeholder bug
      /* istanbul ignore if */
      // 在 ie 浏览器中，如果父节点标签是 textarea 且属性 placeholder 和文本内容相同，则直接返回（处理 ie 浏览器中的一个 bug）
      if (isIE &&
        currentParent.tag === 'textarea' &&
        currentParent.attrsMap.placeholder === text
      ) {
        return
      }
      /**
       * @const {ASTElement[]} children 当前父节点元素的子节点数组
       */
      const children = currentParent.children
      // 如果父节点是 pre 标签或者文本内容不为空，则格式化文本内容
      if (inPre || text.trim()) {
        // 如果父节点标签是 script / style，则文本不做任何处理
        // 否则将文本中的 html 转义字符进行解码处理
        text = isTextTag(currentParent) ? text : decodeHTMLCached(text)
      }
      // 如果父节点标签不是 pre 、文本内容只有空白文本且当前父节点的子节点数组为空时，文本内容为空
      else if (!children.length) {
        // remove the whitespace-only node right after an opening tag
        text = ''
      }
      // 如果父节点标签不是 pre 、文本内容只有空白文本、当前父节点的子节点数组不为空且配置了 whitespaceOption 选项时，特殊处理文本中的换行
      else if (whitespaceOption) {
        // 如果 whitespaceOption 值为 condense，则特殊处理文本中的换行
        if (whitespaceOption === 'condense') {
          // in condense mode, remove the whitespace node if it contains
          // line break, otherwise condense to a single space
          // 如果文本中有换行符号，则将文本赋值为空文本
          // 否则将文本赋值为单个空白文本
          text = lineBreakRE.test(text) ? '' : ' '
        }
        // whitespaceOption 值不为 condense 的情况下，直接将文本赋值为单个空白文本
        else {
          text = ' '
        }
      }
      // 以上条件都不满足时，根据是否保留空白文本选项，将文本内容赋值为单个空白文本或空字符
      else {
        // 如果配置了 preserveWhitespace 保留空白文本选项，则将文本内容赋值为单个空白文本
        // 否则将文本内容赋值为空字符
        text = preserveWhitespace ? ' ' : ''
      }
      // 如果文本内容不为空，则根据文本内容生成文本节点
      if (text) {
        // 如果父节点标签不是 pre 标签且 whitespaceOption 选项为 'condense'，则将文本中的连续的空白文本替换成单个空白文本
        if (!inPre && whitespaceOption === 'condense') {
          // condense consecutive whitespaces into single space
          text = text.replace(whitespaceRE, ' ')
        }
        /**
         * @const {TextParseResult} res 文本差值表达式解析结果
         * @const {ASTNode} child 文本节点 ast 元素
         */
        let res
        let child: ?ASTNode
        // 如果当前节点元素没有使用 v-pre 指令且文本差值表达式解析结果不为空，则根据当前文本内容生成标签属性节点
        if (!inVPre && text !== ' ' && (res = parseText(text, delimiters))) {
          child = {
            type: 2,
            expression: res.expression,
            tokens: res.tokens,
            text
          }
        }
        // 否则根据文本内容生成文本节点元素
        else if (text !== ' ' || !children.length || children[children.length - 1].text !== ' ') {
          child = {
            type: 3,
            text
          }
        }
        // 如果节点元素不为空，则将当前文本节点或属性节点插入节点树中
        if (child) {
          // 如果配置 outputSourceRange 选项，则在开发环境中为节点元素添加 start / end 指针
          if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
            child.start = start
            child.end = end
          }
          // 将元素加入当前父节点的子节点数组中
          children.push(child)
        }
      }
    },

    /**
     * @name comment
     * @description 解析注释内容
     * @param {string} text 注释内容
     * @param {number} start 注释解析开始位置
     * @param {number} end 注释解析结束位置
     */
    comment(text: string, start, end) {
      // adding anything as a sibling to the root node is forbidden
      // comments should still be allowed, but ignored
      // 如果当前父节点元素不存在，则直接返回
      if (currentParent) {
        // 根据注释内容生成文本节点
        const child: ASTText = {
          type: 3,
          text,
          isComment: true
        }
        // 如果配置 outputSourceRange 选项，则在开发环境中为节点元素添加 start / end 指针
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          child.start = start
          child.end = end
        }
        // 将元素加入当前父节点的子节点数组中
        currentParent.children.push(child)
      }
    }
  })
  // 返回节点树的根节点元素
  return root
}

function processPre(el) {
  if (getAndRemoveAttr(el, 'v-pre') != null) {
    el.pre = true
  }
}

function processRawAttrs(el) {
  const list = el.attrsList
  const len = list.length
  if (len) {
    const attrs: Array<ASTAttr> = el.attrs = new Array(len)
    for (let i = 0; i < len; i++) {
      attrs[i] = {
        name: list[i].name,
        value: JSON.stringify(list[i].value)
      }
      if (list[i].start != null) {
        attrs[i].start = list[i].start
        attrs[i].end = list[i].end
      }
    }
  } else if (!el.pre) {
    // non root node in pre blocks with no attributes
    el.plain = true
  }
}

/**
 * @name processElement
 * @description 处理 ast 元素
 * @param {ASTElement} element 标签的 ast 元素
 * @param {CompilerOptions} options ast 处理选项
 */
export function processElement(
  element: ASTElement,
  options: CompilerOptions
) {
  // 处理标签的 key 属性
  processKey(element)

  // determine whether this is a plain element after
  // removing structural attributes
  // 如果标签的 key / scopedSlots / attrsList 属性为空，则标记标签的 ast 为空元素（plain）
  element.plain = (
    !element.key &&
    !element.scopedSlots &&
    !element.attrsList.length
  )

  // 处理标签的 ref 属性
  processRef(element)
  // 处理标签的 slot 插槽属性
  processSlotContent(element)
  // 处理 slot 插槽标签
  processSlotOutlet(element)
  // 处理 is 属性和 inline-template
  processComponent(element)
  // 处理 props、style、class 属性
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element
  }
  // 处理其他属性
  processAttrs(element)
  // 返回节点的 ast 元素
  return element
}

/**
 * @name processKey
 * @description 处理标签的 key 属性
 * @param {ASTElement} el 标签的 ast 元素
 */
function processKey(el) {
  // 获取标签上的 key 绑定属性
  const exp = getBindingAttr(el, 'key')
  // 如果 key 属性不存在，则直接跳过
  if (exp) {
    // 在开发环境中，提示警告信息
    if (process.env.NODE_ENV !== 'production') {
      // 如果标签是 template，则提示警告信息
      if (el.tag === 'template') {
        warn(
          `<template> cannot be keyed. Place the key on real elements instead.`,
          getRawBindingAttr(el, 'key')
        )
      }
      // 如果标签中使用了 `v-for` 指令，且父节点标签是 `'transition-group`，则提示警告信息
      if (el.for) {
        const iterator = el.iterator2 || el.iterator1
        const parent = el.parent
        if (iterator && iterator === exp && parent && parent.tag === 'transition-group') {
          warn(
            `Do not use v-for index as key on <transition-group> children, ` +
            `this is the same as not using keys.`,
            getRawBindingAttr(el, 'key'),
            true /* tip */
          )
        }
      }
    }
    // 将标签的 key 属性赋值于 ast 元素的 key 属性
    el.key = exp
  }
}

/**
 * @name processRef
 * @description 处理标签的 ref 属性
 * @param {ASTElement} el 标签的 ast 元素
 */
function processRef(el) {
  // 获取标签的 ref 属性
  const ref = getBindingAttr(el, 'ref')
  // 如果 ref 不存在，直接返回
  if (ref) {
    // 将标签的 ref 属性添加到 ast 元素的 ref 属性上
    el.ref = ref
    // 如果标签或其父节点使用了 `v-for` 属性，则为 ast 元素添加 `refInFor: true` 的标识
    el.refInFor = checkInFor(el)
  }
}

/**
 * @name processFor
 * @description 处理节点元素的 v-for 指令
 * @param {ASTElement} el 节点元素
 */
export function processFor(el: ASTElement) {
  /** @const {string} exp v-for 指令的值（表达式） */
  let exp
  // 如果 v-for 指令不存在，直接返回
  if ((exp = getAndRemoveAttr(el, 'v-for'))) {
    /** @const {ForParseResult} res v-for 指令的解析结果 */
    const res = parseFor(exp)
    // 如果 v-for 指令解析结果存在，则为当前节点元素添加 v-for 的解析结果
    if (res) {
      extend(el, res)
    }
    // 否则在开发环境提示警告信息
    else if (process.env.NODE_ENV !== 'production') {
      warn(
        `Invalid v-for expression: ${exp}`,
        el.rawAttrsMap['v-for']
      )
    }
  }
}

/**
 * @typedef ForParseResult
 * @description v-for 指令解析结果类型
 * @property {string} for 迭代对象
 * @property {string} alias 迭代项的别名
 * @property {string} iterator1 第一个迭代项，即迭代对象的索引值
 * @property {string} iterator2 第二个迭代项，即迭代对象的引用
 */
type ForParseResult = {
  for: string;
  alias: string;
  iterator1?: string;
  iterator2?: string;
};

/**
 * @name parseFor
 * @description 解析 v-for 指令值的方法
 * @param {string} exp v-for 指令的值
 * @returns {ForParseResult} v-for 指令的解析结果
 */
export function parseFor(exp: string): ?ForParseResult {
  /** @const {string} inMatch v-for 指令值的匹配结果 */
  const inMatch = exp.match(forAliasRE)
  // 如果匹配结果不存在，则直接返回
  if (!inMatch) return
  // 初始化解析结果
  const res = {}
  // 从匹配值中获取迭代对象赋值给解析结果的 for 属性
  res.for = inMatch[2].trim()
  /**
   * @const {string} alias 迭代项别名
   * @const {string} iteratorMatch 额外迭代项匹配结果
  */
  // 从迭代项别名中清除两侧的小括号
  const alias = inMatch[1].trim().replace(stripParensRE, '')
  const iteratorMatch = alias.match(forIteratorRE)
  // 如果额外迭代项匹配结果存在，则在解析结果中添加额外迭代项匹配结果
  if (iteratorMatch) {
    // 在迭代项别名中清除额外迭代项
    res.alias = alias.replace(forIteratorRE, '').trim()
    // 从额外迭代项匹配结果中获取第一个额外迭代项，添加到解析结果的 iterator1 属性上
    res.iterator1 = iteratorMatch[1].trim()
    // 如果额外迭代匹配项中有第二个迭代项，则将第二个迭代项添加到解析结果的 iterator2 属性上
    if (iteratorMatch[2]) {
      res.iterator2 = iteratorMatch[2].trim()
    }
  }
  // 如果额外迭代匹配项不存在，则将迭代别名直接添加到解析结果的 alias 属性上
  else {
    res.alias = alias
  }
  // 返回迭代解析结果
  return res
}

/**
 * @name processIf
 * @description 处理 v-if 指令
 * @param {ASTElement} el 当前节点元素
 */
function processIf(el) {
  /** @const {string} exp v-if 指令的值 */
  const exp = getAndRemoveAttr(el, 'v-if')
  // 如果 v-if 指令的值不为空，则为当前节点元素添加 if 分支判断
  if (exp) {
    // 将 v-if 的值存储在当前节点元素的 if 属性中
    el.if = exp
    // 为当前节点元素添加 if 分支判断
    addIfCondition(el, {
      exp: exp,
      block: el
    })
  }
  // 否则处理 v-else / v-else-if
  else {
    // 如果节点元素存在 v-else 指令，则为节点元素添加 else 的属性，值为true
    if (getAndRemoveAttr(el, 'v-else') != null) {
      el.else = true
    }
    /** @const {string} elseif v-else-if 的值  */
    const elseif = getAndRemoveAttr(el, 'v-else-if')
    // 如果节点上存在 v-else-if 指令，则将该值赋予节点的 elseif 属性
    if (elseif) {
      el.elseif = elseif
    }
  }
}

/**
 * @name processIfConditions
 * @description 为当前节点元素添加 else if / else 的分支判断
 * @param {ASTElement} el 当前节点元素
 * @param {ASTElement} parent 当前父节点元素
 */
function processIfConditions(el, parent) {
  /** @const {ASTElement} prev 当前节点元素的上一个节点元素 */
  const prev = findPrevElement(parent.children)
  // 如果上一个节点元素存在且有 if 分支判断，则为上一个节点元素添加 else if / else 的分支判断
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el
    })
  }
  // 如果上一个节点元素不存在，则在开发环境中提示警告信息
  else if (process.env.NODE_ENV !== 'production') {
    warn(
      `v-${el.elseif ? ('else-if="' + el.elseif + '"') : 'else'} ` +
      `used on element <${el.tag}> without corresponding v-if.`,
      el.rawAttrsMap[el.elseif ? 'v-else-if' : 'v-else']
    )
  }
}

/**
 * @name findPrevElement
 * @description 获取当前节点元素的上一个节点元素
 * @param {ASTElement[]} children 当前父节点元素的子节点数组
 * @returns {ASTElement} 当前节点元素的上一个节点元素
 */
function findPrevElement(children: Array<any>): ASTElement | void {
  // 获取当前父节点元素的子节点数组长度
  let i = children.length
  // 循环子节点数组，找到上一个元素节点并返回
  while (i--) {
    // 检查节点类型是否为元素，如果是元素就直接返回
    if (children[i].type === 1) {
      return children[i]
    }
    // 否则就将该节点从子节点数组中删除，并在开发环境中提示警告信息
    else {
      if (process.env.NODE_ENV !== 'production' && children[i].text !== ' ') {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
          `will be ignored.`,
          children[i]
        )
      }
      children.pop()
    }
  }
}

/**
 * @name addIfCondition
 * @description 为当前节点元素添加 if 分支判断
 * @param {ASTElement} el 当前节点元素
 * @param {ASTIfCondition} condition if 分支判断的表达式
 */
export function addIfCondition(el: ASTElement, condition: ASTIfCondition) {
  // 如果当前节点元素没有 ifConditions 属性，则为当前节点元素添加该属性
  if (!el.ifConditions) {
    el.ifConditions = []
  }
  // 为当前节点元素的 ifConditions 属性添加 condition 分支判断
  el.ifConditions.push(condition)
}

function processOnce(el) {
  const once = getAndRemoveAttr(el, 'v-once')
  if (once != null) {
    el.once = true
  }
}

// handle content being passed to a component as slot,
// e.g. <template slot="xxx">, <div slot-scope="xxx">
/**
 * @name processSlotContent
 * @description 处理标签的 slot 属性
 * @param {ASTElement} el 标签的 ast 元素
 */
function processSlotContent(el) {
  // 初始化 `slotScope`
  let slotScope
  // 如果标签名是`template`，则从标签的 `scope` 属性获取 `slotScope`的值
  if (el.tag === 'template') {
    slotScope = getAndRemoveAttr(el, 'scope')
    /* istanbul ignore if */
    // 如果在开发环境中，且标签的 `scope` 属性存在，则提示警告信息
    if (process.env.NODE_ENV !== 'production' && slotScope) {
      warn(
        `the "scope" attribute for scoped slots have been deprecated and ` +
        `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
        `can also be used on plain elements in addition to <template> to ` +
        `denote scoped slots.`,
        el.rawAttrsMap['scope'],
        true
      )
    }
    // 如果标签的`scope`属性不存在，则从标签的`slot-scope`属性中获取`slotScope`
    el.slotScope = slotScope || getAndRemoveAttr(el, 'slot-scope')
  }
  // 否则从标签的`slot-scope`属性获取`slotScope`的值
  else if ((slotScope = getAndRemoveAttr(el, 'slot-scope'))) {
    /* istanbul ignore if */
    // 如果标签同时使用了`v-for`指令，则在开发环境中提示警告信息
    if (process.env.NODE_ENV !== 'production' && el.attrsMap['v-for']) {
      warn(
        `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
        `(v-for takes higher priority). Use a wrapper <template> for the ` +
        `scoped slot to make it clearer.`,
        el.rawAttrsMap['slot-scope'],
        true
      )
    }
    // 为 ast 元素添加属性`slotScope`
    el.slotScope = slotScope
  }

  // slot="xxx"
  // 获取标签的`slot`属性值，作为插槽目标
  const slotTarget = getBindingAttr(el, 'slot')
  // 如果插槽目标不存在，则直接跳过
  if (slotTarget) {
    // 获取插槽名称，默认为`default`
    el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget
    // 如果插槽属性 `slot` 是绑定属性，则为 ast 添加属性`slotTargetDynamic: true`
    el.slotTargetDynamic = !!(el.attrsMap[':slot'] || el.attrsMap['v-bind:slot'])
    // preserve slot as an attribute for native shadow DOM compat
    // only for non-scoped slots.
    // 如果插槽没有局部属性`slotScope`，且标签不是`template`，则重新为标签的原生属性添加`slot`属性
    if (el.tag !== 'template' && !el.slotScope) {
      addAttr(el, 'slot', slotTarget, getRawBindingAttr(el, 'slot'))
    }
  }

  // 2.6 v-slot syntax
  // 如果使用了新插槽语法，则解析`v-slot`指令
  if (process.env.NEW_SLOT_SYNTAX) {
    // 如果标签是`template`，则直接插槽的相关属性赋值给当前标签的 ast 元素
    if (el.tag === 'template') {
      // v-slot on <template>
      // 获取标签的 `v-slot` 指令的属性对象
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      // 如果属性值不存在，则直接跳过
      if (slotBinding) {
        // 在开发环境中，针对错误使用的情况给出提示
        if (process.env.NODE_ENV !== 'production') {
          // 如果同时使用了`slot`、`slot-scope`，则提示不能混用语法
          if (el.slotTarget || el.slotScope) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          // 如果拥有`v-slot`的`template`标签不是其父节点的直接子节点，则提示错误信息
          if (el.parent && !maybeComponent(el.parent)) {
            warn(
              `<template v-slot> can only appear at the root level inside ` +
              `the receiving component`,
              el
            )
          }
        }
        // 从`v-slot`属性对象上获取插槽名称`name`和动态参数`dynamic`
        const { name, dynamic } = getSlotName(slotBinding)
        // 将插槽名称赋值给 ast 元素的`slotTarget`属性
        el.slotTarget = name
        // 将动态参数`dynamic`赋值给 ast 元素的`slotTargetDynamic`属性
        el.slotTargetDynamic = dynamic
        // 将`v-slot`指令的值作为`slotScope`赋值给 ast 元素，默认为`_empty_`
        el.slotScope = slotBinding.value || emptySlotScopeToken // force it into a scoped slot for perf
      }
    } else {
      // v-slot on component, denotes default slot
      // 获取标签的 `v-slot` 指令的属性对象
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      // 如果不存在`v-slot`指令，则直接跳过
      if (slotBinding) {
        // 在开发环境中，针对错误使用的情况给出提示
        if (process.env.NODE_ENV !== 'production') {
          // 如果当前标签不是组件标签，则提示必须在组件或`template`标签上使用`v-slot`
          if (!maybeComponent(el)) {
            warn(
              `v-slot can only be used on components or <template>.`,
              slotBinding
            )
          }
          // 如果同时使用了`v-slot`和`slot`、`slot-scope`，则提示插槽语法不能混用
          if (el.slotScope || el.slotTarget) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          // 如果有其他具名局部插槽，为防止插槽作用域冲突，提示默认插槽也要使用`template`标签
          if (el.scopedSlots) {
            warn(
              `To avoid scope ambiguity, the default slot should also use ` +
              `<template> syntax when there are other named slots.`,
              slotBinding
            )
          }
        }
        // add the component's children to its default slot
        /**
         * @const {Record<string, ASTElement>} slots 插槽节点元素列表
         * @const {string} name 插槽名
         * @const {boolean} dynamic 插槽是否为动态插槽
         * @const {ASTElement} slotContainer 插槽元素
         */
        const slots = el.scopedSlots || (el.scopedSlots = {})
        // 根据 v-slot 的值获取插槽的名称、动态标识
        const { name, dynamic } = getSlotName(slotBinding)
        // 创建 template 元素作为插槽元素，指明其父节点为当前节点元素
        const slotContainer = slots[name] = createASTElement('template', [], el)
        // 为插槽元素添加 slotTarget 属性，其值为插槽名
        slotContainer.slotTarget = name
        // 为插槽元素添加 slotTargetDynamic 属性，其值为插槽的动态标识符
        slotContainer.slotTargetDynamic = dynamic
        // 为插槽元素添加 children 属性，其值为元素子节点没有 slotScope 属性的子节点列表
        slotContainer.children = el.children.filter((c: any) => {
          if (!c.slotScope) {
            c.parent = slotContainer
            return true
          }
        })
        // 为插槽元素添加 slotScope 属性，其值为 v-slot 的值
        slotContainer.slotScope = slotBinding.value || emptySlotScopeToken
        // remove children as they are returned from scopedSlots now
        // 清空当前节点元素的子元素
        el.children = []
        // mark el non-plain so data gets generated
        // 标记当前元素为非 plain
        el.plain = false
      }
    }
  }
}

/**
 * @name getSlotName
 * @description 获取插槽名称的方法
 * @param {ASTAttr} binding 绑定属性
 * @returns {{ name: strig; dynamic: boolean }} 插槽名称对象
 */
function getSlotName(binding) {
  // 将 v-slot 指令中的 v-slot 去掉，只留下插槽名
  let name = binding.name.replace(slotRE, '')
  if (!name) {
    // 如果插槽名不存在，且没有使用 v-slot 简写，则为插槽名赋默认值'default'
    if (binding.name[0] !== '#') {
      name = 'default'
    }
    // 否则在开发环境中提示警告信息
    else if (process.env.NODE_ENV !== 'production') {
      warn(
        `v-slot shorthand syntax requires a slot name.`,
        binding
      )
    }
  }
  // 如果插槽名是动态的，则清除掉插槽名两侧的'[]'符号
  // 返回插槽名与动态插槽标识
  return dynamicArgRE.test(name)
    // dynamic [name]
    ? { name: name.slice(1, -1), dynamic: true }
    // static name
    : { name: `"${name}"`, dynamic: false }
}

// handle <slot/> outlets
/**
 * @name processSlotOutlet
 * @description 处理标签插槽
 * @param {ASTElement} el 插槽标签的 ast 元素
 */
function processSlotOutlet(el) {
  // 如果标签名不是`slot`，则直接跳过
  if (el.tag === 'slot') {
    // 获取具名插槽的`name`属性，赋值给 ast 元素的`slotName`
    el.slotName = getBindingAttr(el, 'name')
    // 如果标签中含有 key 属性，则在开发环境中提示警告信息
    if (process.env.NODE_ENV !== 'production' && el.key) {
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
        `and can possibly expand into multiple elements. ` +
        `Use the key on a wrapping element instead.`,
        getRawBindingAttr(el, 'key')
      )
    }
  }
}

/**
 * @name processComponent
 * @description 处理标签中的 is 属性和 inline-temmplate属性
 * @param {ASTElement} el 节点 ast 元素
 */
function processComponent(el) {
  let binding
  // 如果存在绑定的 is 属性，则为元素添加 component 属性，值即为 is 属性的值
  if ((binding = getBindingAttr(el, 'is'))) {
    el.component = binding
  }
  // 如果存在 inline-template 属性，则为元素添加 inlineTemplate 属性，值为 true
  if (getAndRemoveAttr(el, 'inline-template') != null) {
    el.inlineTemplate = true
  }
}

/**
 * @name processAttrs
 * @description 处理其他的属性
 * @param {ASTElement} el 节点的 ast 元素
 */
function processAttrs(el) {
  /**
   * @const {ASTAttr[]} list 节点属性列表
   * @const {number} i 循环节点属性列表的索引指针
   * @const {number} l 节点属性列表的长度
   * @const {string} rawName 原始节点属性名
   * @const {string} name 节点属性名
   * @const {string} value 节点属性值
   * @const {Record<string, true>} modifiers 修饰符集合
   * @const {string} syncGen 赋值操作代码
   * @const {boolean} isDynamic 属性是否为动态的标识符
   */
  const list = el.attrsList
  let i, l, name, rawName, value, modifiers, syncGen, isDynamic

  // 循环节点属性列表，处理节点属性，生成逻辑代码
  for (i = 0, l = list.length; i < l; i++) {
    // 获取属性名
    name = rawName = list[i].name
    // 获取属性值
    value = list[i].value
    // 如果当前属性使用了指令，则根据指令类型生成相应的逻辑代码
    if (dirRE.test(name)) {
      // mark element as dynamic
      // 标记当前节点元素是动态元素
      el.hasBindings = true
      // modifiers
      // 获取指令修饰符
      modifiers = parseModifiers(name.replace(dirRE, ''))
      // support .foo shorthand syntax for the .prop modifier
      // 如果使用了 v-bind 的简写形式 `.prop`，则为指令添加修饰符 prop，且在指令前添加`.`
      if (process.env.VBIND_PROP_SHORTHAND && propBindRE.test(name)) {
        // 为指令添加 prop 修饰符
        (modifiers || (modifiers = {})).prop = true
        // 在指令前添加`.`，且在指令名中清除修饰符
        name = `.` + name.slice(1).replace(modifierRE, '')
      }
      // 如果没有使用指令修饰符的简写形式，且指令修饰符不为空，则在指令名中清除修饰符
      else if (modifiers) {
        name = name.replace(modifierRE, '')
      }
      // 当前属性使用了v-bind指令，则生成动态获取属性值的代码，添加到节点元素上
      if (bindRE.test(name)) { // v-bind
        // 清除属性名中的指令部分
        name = name.replace(bindRE, '')
        // 生成动态获取属性值的代码，赋值给value
        value = parseFilters(value)
        // 获取判断当前属性名是否是动态属性名的标识符 isDynamic
        isDynamic = dynamicArgRE.test(name)
        // 如果当前属性名是动态属性名，则属性名去掉两侧的中括号
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        // 如果在开发环境中发现属性值为空，则提示警告信息
        if (
          process.env.NODE_ENV !== 'production' &&
          value.trim().length === 0
        ) {
          warn(
            `The value for a v-bind expression cannot be empty. Found in "v-bind:${name}"`
          )
        }
        // 处理指令修饰符 prop、camel、sync
        if (modifiers) {
          // 属性名非动态的情况下，处理 prop 修饰符
          if (modifiers.prop && !isDynamic) {
            // 将属性名转为驼峰命名
            name = camelize(name)
            // 如果属性名为 innerHtml，则将属性名转为 innerHTML
            if (name === 'innerHtml') name = 'innerHTML'
          }
          // 属性名非动态的情况下，处理 camel 修饰符
          if (modifiers.camel && !isDynamic) {
            // 将属性名转为驼峰命名
            name = camelize(name)
          }
          // 处理 sync 属性修饰符
          if (modifiers.sync) {
            // 生成属性的赋值语句代码
            syncGen = genAssignmentCode(value, `$event`)
            // 如果属性是非动态的，则为节点元素添加 update 更新事件
            if (!isDynamic) {
              // 为节点元素添加 `update:${camelize(name)}`事件
              addHandler(
                el,
                `update:${camelize(name)}`,
                syncGen,
                null,
                false,
                warn,
                list[i]
              )
              // 如果属性名与hyphenate格式的属性名不同，则为节点元素添加`update:${hyphenate(name)}`事件
              if (hyphenate(name) !== camelize(name)) {
                addHandler(
                  el,
                  `update:${hyphenate(name)}`,
                  syncGen,
                  null,
                  false,
                  warn,
                  list[i]
                )
              }
            }
            // 如果属性是动态的，则为节点添加`update:${name}`事件
            else {
              // handler w/ dynamic event name
              addHandler(
                el,
                `"update:"+(${name})`,
                syncGen,
                null,
                false,
                warn,
                list[i],
                true // dynamic
              )
            }
          }
        }
        // 使用了 prop 修饰符或必须使用属性时，则将属性添加到元素的 props 数组中
        if ((modifiers && modifiers.prop) || (
          !el.component && platformMustUseProp(el.tag, el.attrsMap.type, name)
        )) {
          addProp(el, name, value, list[i], isDynamic)
        }
        // 否则将属性添加到元素的 attrs 数组中
        else {
          addAttr(el, name, value, list[i], isDynamic)
        }
      }
      // 如果属性使用了 v-on 指令，则生成对应的事件处理函数绑定到元素上
      else if (onRE.test(name)) { // v-on
        // 从属性名中删除v-on指令
        name = name.replace(onRE, '')
        // 获取属性名是否为动态属性的标识符
        isDynamic = dynamicArgRE.test(name)
        // 如果属性名为动态属性名，则属性名应截去两侧的`[]`符号
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        // 为元素添加对应属性名的事件
        addHandler(el, name, value, modifiers, false, warn, list[i], isDynamic)
      }
      // 否则认为属性使用的是普通的指令
      else { // normal directives
        // 在属性名中删除掉指令部分
        name = name.replace(dirRE, '')
        // parse arg
        /**
         * @const {string} arg 获取属性参数
         */
        const argMatch = name.match(argRE)
        let arg = argMatch && argMatch[1]
        isDynamic = false
        // 如果指令参数存在，则处理指令参数
        if (arg) {
          // 将属性名中的属性参数删除
          name = name.slice(0, -(arg.length + 1))
          // 如果属性参数是动态的，则将参数两侧的`[]`符号去掉，并标记当前参数为动态参数
          if (dynamicArgRE.test(arg)) {
            arg = arg.slice(1, -1)
            isDynamic = true
          }
        }
        // 将当前指令添加到元素的 directives 数组中
        addDirective(el, name, rawName, value, arg, isDynamic, modifiers, list[i])
        // 在开发环境中检查是否用 v-model 绑定了 v-for 指令中的 alias
        if (process.env.NODE_ENV !== 'production' && name === 'model') {
          checkForAliasModel(el, value)
        }
      }
    }
    // 如果当前属性没有使用任何指令，则为元素添加普通的标签属性
    else {
      // literal attribute
      // 在开发环境中尝试获取属性值中的差值表达式，如果差值表达式不为空，则提示警告信息
      if (process.env.NODE_ENV !== 'production') {
        const res = parseText(value, delimiters)
        if (res) {
          warn(
            `${name}="${value}": ` +
            'Interpolation inside attributes has been removed. ' +
            'Use v-bind or the colon shorthand instead. For example, ' +
            'instead of <div id="{{ val }}">, use <div :id="val">.',
            list[i]
          )
        }
      }
      // 为元素添加静态标签属性
      addAttr(el, name, JSON.stringify(value), list[i])
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      // 为解决在火狐浏览器中动态添加的 muted 属性不更新的问题，特地以 prop 的形式为元素添加 muted 属性
      if (!el.component &&
        name === 'muted' &&
        platformMustUseProp(el.tag, el.attrsMap.type, name)) {
        addProp(el, name, 'true', list[i])
      }
    }
  }
}

/**
 * @name checkInFor
 * @description 检查当前元素是否在 v-for 指令中
 * @param {ASTElement} el 当前节点元素
 * @returns {boolean} 当前元素在 v-for 指令的标识符
 */
function checkInFor(el: ASTElement): boolean {
  let parent = el
  while (parent) {
    if (parent.for !== undefined) {
      return true
    }
    parent = parent.parent
  }
  return false
}

/**
 * @name parseModifiers
 * @description 解析属性修饰符
 * @param {string} name 属性名
 * @returns {Record<string, true>} 修饰符集合
 */
function parseModifiers(name: string): Object | void {
  // 获取属性修饰符匹配结果
  const match = name.match(modifierRE)
  if (match) {
    const ret = {}
    // 解析属性修饰符的匹配结果，将其保存在 ret 集合中
    match.forEach(m => { ret[m.slice(1)] = true })
    // 返回 ret 集合
    return ret
  }
}

function makeAttrsMap(attrs: Array<Object>): Object {
  const map = {}
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (
      process.env.NODE_ENV !== 'production' &&
      map[attrs[i].name] && !isIE && !isEdge
    ) {
      warn('duplicate attribute: ' + attrs[i].name, attrs[i])
    }
    map[attrs[i].name] = attrs[i].value
  }
  return map
}

// for script (e.g. type="x/template") or style, do not decode content
function isTextTag(el): boolean {
  return el.tag === 'script' || el.tag === 'style'
}

function isForbiddenTag(el): boolean {
  return (
    el.tag === 'style' ||
    (el.tag === 'script' && (
      !el.attrsMap.type ||
      el.attrsMap.type === 'text/javascript'
    ))
  )
}

const ieNSBug = /^xmlns:NS\d+/
const ieNSPrefix = /^NS\d+:/

/* istanbul ignore next */
function guardIESVGBug(attrs) {
  const res = []
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    if (!ieNSBug.test(attr.name)) {
      attr.name = attr.name.replace(ieNSPrefix, '')
      res.push(attr)
    }
  }
  return res
}

function checkForAliasModel(el, value) {
  let _el = el
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
        `You are binding v-model directly to a v-for iteration alias. ` +
        `This will not be able to modify the v-for source array because ` +
        `writing to the alias is like modifying a function local variable. ` +
        `Consider using an array of objects and use v-model on an object property instead.`,
        el.rawAttrsMap['v-model']
      )
    }
    _el = _el.parent
  }
}
