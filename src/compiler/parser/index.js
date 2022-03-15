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
  // 根元素 ast
  let root
  // 当前父节点 ast
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
    // 去除标签子节点尾部的空节点
    trimEndingWhitespace(element)
    if (!inVPre && !element.processed) {
      element = processElement(element, options)
    }
    // tree management
    if (!stack.length && element !== root) {
      // allow root elements with v-if, v-else-if and v-else
      if (root.if && (element.elseif || element.else)) {
        if (process.env.NODE_ENV !== 'production') {
          checkRootConstraints(element)
        }
        addIfCondition(root, {
          exp: element.elseif,
          block: element
        })
      } else if (process.env.NODE_ENV !== 'production') {
        warnOnce(
          `Component template should contain exactly one root element. ` +
          `If you are using v-if on multiple elements, ` +
          `use v-else-if to chain them instead.`,
          { start: element.start }
        )
      }
    }
    if (currentParent && !element.forbidden) {
      if (element.elseif || element.else) {
        processIfConditions(element, currentParent)
      } else {
        if (element.slotScope) {
          // scoped slot
          // keep it in the children list so that v-else(-if) conditions can
          // find it as the prev node.
          const name = element.slotTarget || '"default"'
            ; (currentParent.scopedSlots || (currentParent.scopedSlots = {}))[name] = element
        }
        currentParent.children.push(element)
        element.parent = currentParent
      }
    }

    // final children cleanup
    // filter out scoped slots
    element.children = element.children.filter(c => !(c: any).slotScope)
    // remove trailing whitespace node again
    trimEndingWhitespace(element)

    // check pre state
    if (element.pre) {
      inVPre = false
    }
    if (platformIsPreTag(element.tag)) {
      inPre = false
    }
    // apply post-transforms
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
    // 解析开始标签
    start(tag, attrs, unary, start, end) {
      // check namespace.
      // inherit parent ns if there is one
      const ns = (currentParent && currentParent.ns) || platformGetTagNamespace(tag)

      // handle IE svg bug
      /* istanbul ignore if */
      if (isIE && ns === 'svg') {
        attrs = guardIESVGBug(attrs)
      }

      let element: ASTElement = createASTElement(tag, attrs, currentParent)
      if (ns) {
        element.ns = ns
      }

      if (process.env.NODE_ENV !== 'production') {
        if (options.outputSourceRange) {
          element.start = start
          element.end = end
          element.rawAttrsMap = element.attrsList.reduce((cumulated, attr) => {
            cumulated[attr.name] = attr
            return cumulated
          }, {})
        }
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

      if (isForbiddenTag(element) && !isServerRendering()) {
        element.forbidden = true
        process.env.NODE_ENV !== 'production' && warn(
          'Templates should only be responsible for mapping the state to the ' +
          'UI. Avoid placing tags with side-effects in your templates, such as ' +
          `<${tag}>` + ', as they will not be parsed.',
          { start: element.start }
        )
      }

      // apply pre-transforms
      for (let i = 0; i < preTransforms.length; i++) {
        element = preTransforms[i](element, options) || element
      }

      if (!inVPre) {
        processPre(element)
        if (element.pre) {
          inVPre = true
        }
      }
      if (platformIsPreTag(element.tag)) {
        inPre = true
      }
      if (inVPre) {
        processRawAttrs(element)
      } else if (!element.processed) {
        // structural directives
        processFor(element)
        processIf(element)
        processOnce(element)
      }

      if (!root) {
        root = element
        if (process.env.NODE_ENV !== 'production') {
          checkRootConstraints(root)
        }
      }

      if (!unary) {
        currentParent = element
        stack.push(element)
      } else {
        closeElement(element)
      }
    },

    // 解析结束标签
    end(tag, start, end) {
      const element = stack[stack.length - 1]
      // pop stack
      stack.length -= 1
      currentParent = stack[stack.length - 1]
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        element.end = end
      }
      closeElement(element)
    },

    // 解析文本内容
    chars(text: string, start: number, end: number) {
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
      if (isIE &&
        currentParent.tag === 'textarea' &&
        currentParent.attrsMap.placeholder === text
      ) {
        return
      }
      const children = currentParent.children
      if (inPre || text.trim()) {
        text = isTextTag(currentParent) ? text : decodeHTMLCached(text)
      } else if (!children.length) {
        // remove the whitespace-only node right after an opening tag
        text = ''
      } else if (whitespaceOption) {
        if (whitespaceOption === 'condense') {
          // in condense mode, remove the whitespace node if it contains
          // line break, otherwise condense to a single space
          text = lineBreakRE.test(text) ? '' : ' '
        } else {
          text = ' '
        }
      } else {
        text = preserveWhitespace ? ' ' : ''
      }
      if (text) {
        if (!inPre && whitespaceOption === 'condense') {
          // condense consecutive whitespaces into single space
          text = text.replace(whitespaceRE, ' ')
        }
        let res
        let child: ?ASTNode
        if (!inVPre && text !== ' ' && (res = parseText(text, delimiters))) {
          child = {
            type: 2,
            expression: res.expression,
            tokens: res.tokens,
            text
          }
        } else if (text !== ' ' || !children.length || children[children.length - 1].text !== ' ') {
          child = {
            type: 3,
            text
          }
        }
        if (child) {
          if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
            child.start = start
            child.end = end
          }
          children.push(child)
        }
      }
    },

    // 解析注释内容
    comment(text: string, start, end) {
      // adding anything as a sibling to the root node is forbidden
      // comments should still be allowed, but ignored
      if (currentParent) {
        const child: ASTText = {
          type: 3,
          text,
          isComment: true
        }
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          child.start = start
          child.end = end
        }
        currentParent.children.push(child)
      }
    }
  })
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
  // 
  processComponent(element)
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element
  }
  processAttrs(element)
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
 * @description 
 * @param {*} el 
 */
export function processFor(el: ASTElement) {
  let exp
  if ((exp = getAndRemoveAttr(el, 'v-for'))) {
    const res = parseFor(exp)
    if (res) {
      extend(el, res)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `Invalid v-for expression: ${exp}`,
        el.rawAttrsMap['v-for']
      )
    }
  }
}

type ForParseResult = {
  for: string;
  alias: string;
  iterator1?: string;
  iterator2?: string;
};

export function parseFor(exp: string): ?ForParseResult {
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return
  const res = {}
  res.for = inMatch[2].trim()
  const alias = inMatch[1].trim().replace(stripParensRE, '')
  const iteratorMatch = alias.match(forIteratorRE)
  if (iteratorMatch) {
    res.alias = alias.replace(forIteratorRE, '').trim()
    res.iterator1 = iteratorMatch[1].trim()
    if (iteratorMatch[2]) {
      res.iterator2 = iteratorMatch[2].trim()
    }
  } else {
    res.alias = alias
  }
  return res
}

function processIf(el) {
  const exp = getAndRemoveAttr(el, 'v-if')
  if (exp) {
    el.if = exp
    addIfCondition(el, {
      exp: exp,
      block: el
    })
  } else {
    if (getAndRemoveAttr(el, 'v-else') != null) {
      el.else = true
    }
    const elseif = getAndRemoveAttr(el, 'v-else-if')
    if (elseif) {
      el.elseif = elseif
    }
  }
}

function processIfConditions(el, parent) {
  const prev = findPrevElement(parent.children)
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el
    })
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `v-${el.elseif ? ('else-if="' + el.elseif + '"') : 'else'} ` +
      `used on element <${el.tag}> without corresponding v-if.`,
      el.rawAttrsMap[el.elseif ? 'v-else-if' : 'v-else']
    )
  }
}

function findPrevElement(children: Array<any>): ASTElement | void {
  let i = children.length
  while (i--) {
    if (children[i].type === 1) {
      return children[i]
    } else {
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

export function addIfCondition(el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = []
  }
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
          // 
          if (el.scopedSlots) {
            warn(
              `To avoid scope ambiguity, the default slot should also use ` +
              `<template> syntax when there are other named slots.`,
              slotBinding
            )
          }
        }
        // add the component's children to its default slot
        const slots = el.scopedSlots || (el.scopedSlots = {})
        const { name, dynamic } = getSlotName(slotBinding)
        const slotContainer = slots[name] = createASTElement('template', [], el)
        slotContainer.slotTarget = name
        slotContainer.slotTargetDynamic = dynamic
        slotContainer.children = el.children.filter((c: any) => {
          if (!c.slotScope) {
            c.parent = slotContainer
            return true
          }
        })
        slotContainer.slotScope = slotBinding.value || emptySlotScopeToken
        // remove children as they are returned from scopedSlots now
        el.children = []
        // mark el non-plain so data gets generated
        el.plain = false
      }
    }
  }
}

function getSlotName(binding) {
  let name = binding.name.replace(slotRE, '')
  if (!name) {
    if (binding.name[0] !== '#') {
      name = 'default'
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `v-slot shorthand syntax requires a slot name.`,
        binding
      )
    }
  }
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

function processComponent(el) {
  let binding
  if ((binding = getBindingAttr(el, 'is'))) {
    el.component = binding
  }
  if (getAndRemoveAttr(el, 'inline-template') != null) {
    el.inlineTemplate = true
  }
}

function processAttrs(el) {
  const list = el.attrsList
  let i, l, name, rawName, value, modifiers, syncGen, isDynamic
  for (i = 0, l = list.length; i < l; i++) {
    name = rawName = list[i].name
    value = list[i].value
    if (dirRE.test(name)) {
      // mark element as dynamic
      el.hasBindings = true
      // modifiers
      modifiers = parseModifiers(name.replace(dirRE, ''))
      // support .foo shorthand syntax for the .prop modifier
      if (process.env.VBIND_PROP_SHORTHAND && propBindRE.test(name)) {
        (modifiers || (modifiers = {})).prop = true
        name = `.` + name.slice(1).replace(modifierRE, '')
      } else if (modifiers) {
        name = name.replace(modifierRE, '')
      }
      if (bindRE.test(name)) { // v-bind
        name = name.replace(bindRE, '')
        value = parseFilters(value)
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        if (
          process.env.NODE_ENV !== 'production' &&
          value.trim().length === 0
        ) {
          warn(
            `The value for a v-bind expression cannot be empty. Found in "v-bind:${name}"`
          )
        }
        if (modifiers) {
          if (modifiers.prop && !isDynamic) {
            name = camelize(name)
            if (name === 'innerHtml') name = 'innerHTML'
          }
          if (modifiers.camel && !isDynamic) {
            name = camelize(name)
          }
          if (modifiers.sync) {
            syncGen = genAssignmentCode(value, `$event`)
            if (!isDynamic) {
              addHandler(
                el,
                `update:${camelize(name)}`,
                syncGen,
                null,
                false,
                warn,
                list[i]
              )
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
            } else {
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
        if ((modifiers && modifiers.prop) || (
          !el.component && platformMustUseProp(el.tag, el.attrsMap.type, name)
        )) {
          addProp(el, name, value, list[i], isDynamic)
        } else {
          addAttr(el, name, value, list[i], isDynamic)
        }
      } else if (onRE.test(name)) { // v-on
        name = name.replace(onRE, '')
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        addHandler(el, name, value, modifiers, false, warn, list[i], isDynamic)
      } else { // normal directives
        name = name.replace(dirRE, '')
        // parse arg
        const argMatch = name.match(argRE)
        let arg = argMatch && argMatch[1]
        isDynamic = false
        if (arg) {
          name = name.slice(0, -(arg.length + 1))
          if (dynamicArgRE.test(arg)) {
            arg = arg.slice(1, -1)
            isDynamic = true
          }
        }
        addDirective(el, name, rawName, value, arg, isDynamic, modifiers, list[i])
        if (process.env.NODE_ENV !== 'production' && name === 'model') {
          checkForAliasModel(el, value)
        }
      }
    } else {
      // literal attribute
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
      addAttr(el, name, JSON.stringify(value), list[i])
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      if (!el.component &&
        name === 'muted' &&
        platformMustUseProp(el.tag, el.attrsMap.type, name)) {
        addProp(el, name, 'true', list[i])
      }
    }
  }
}

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

function parseModifiers(name: string): Object | void {
  const match = name.match(modifierRE)
  if (match) {
    const ret = {}
    match.forEach(m => { ret[m.slice(1)] = true })
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
