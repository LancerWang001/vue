/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */
// 核心原理借鉴了`simple-html-parser`库

import { makeMap, no } from 'shared/util'
import { isNonPhrasingTag } from 'web/compiler/util'
import { unicodeRegExp } from 'core/util/lang'

// Regular Expressions for parsing tags and attributes
// 解析标签和属性的正则表达式

// 属性的正则表达式 name="zhangsan"
const attribute = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
// 动态属性的正则表达式 @[attr]="zhangsan"
const dynamicArgAttribute = /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+?\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
// 标签名正则表达式
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`
// 修饰符正则表达式 Tag:decorator
const qnameCapture = `((?:${ncname}\\:)?${ncname})`
// 开始标签头部正则表达式 <Start:decorator
const startTagOpen = new RegExp(`^<${qnameCapture}`)
// 开始标签的尾部正则表达式 >
const startTagClose = /^\s*(\/?)>/
// 结束标签的正则表达式
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
// html文档声明的正则表达式
const doctype = /^<!DOCTYPE [^>]+>/i
// #7298: escape - to avoid being passed as HTML comment when inlined in page
// 注释的正则表达式
const comment = /^<!\--/
// 条件注释的正则表达式
const conditionalComment = /^<!\[/

// Special Elements (can contain anything)
// 子节点是纯文本节点的标签
export const isPlainTextElement = makeMap('script,style,textarea', true)
// 正则表达式缓存
const reCache = {}

// html转义符映射
const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t',
  '&#39;': "'"
}
// 属性中的html转义字符正则表达式
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g
// 属性中需要换行的html转义字符正则表达式
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g

// #5992
// 忽略换行的标签
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
/**
 * @name shouldIgnoreFirstNewline
 * @description 是否在标签子节点中忽略第一个换行符
 * @param {string} tag 标签名
 * @param {string} html html字符串
 * @returns {boolean} 是否忽略第一个换行
 */
const shouldIgnoreFirstNewline = (tag, html) => tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

/**
 * @name decodeAttr
 * @description 还原html转义字符
 * @param {string} value 被解析的属性值
 * @param {boolean} shouldDecodeNewlines 是否应该解析换行
 * @returns {string} 还原html转义后的字符
 */
function decodeAttr(value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  return value.replace(re, match => decodingMap[match])
}

/**
 * @name parseHTML
 * @description 解析html字符串
 * @param {string} html 
 * @param {Object} options 
 */
export function parseHTML(html, options) {
  // 创建标签元素栈
  const stack = []
  // 获取是否以HTML规范约束标签解析的标识
  const expectHTML = options.expectHTML
  // 获取判断是否是单标签的方法
  const isUnaryTag = options.isUnaryTag || no
  // 获取判断是否是自闭合的双标签的方法
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no
  // 当前的模版解析指针位置
  let index = 0
  /**
   * @const {string} last 剩余模版字符串
   * @const {string} lastTag 上一个处理过的标签
   * @description 循环遍历 html 模版，解析其中的标签、文本、注释、文档声明
   */
  let last, lastTag
  while (html) {
    // 保存当前的 html 模版
    last = html
    // Make sure we're not in a plaintext content element like script/style
    // 如果当前内容不在 script/style 标签中，则以 html 的语法规则解析其中的注释、文档声明、标签、文本
    if (!lastTag || !isPlainTextElement(lastTag)) {
      // 获取第一个符号 '<' 在模版中的位置
      let textEnd = html.indexOf('<')
      // 如果第一个符号 '<' 位于模版开头，则以注释、文档声明、标签的规则进行解析
      if (textEnd === 0) {
        // Comment:
        // 如果是普通注释，则以普通注释的规则进行解析
        if (comment.test(html)) {
          // 获取 '-->' 符号在模版中的位置
          const commentEnd = html.indexOf('-->')

          // 如果 '-->' 在模版中存在，则说明当前段落为普通注释
          if (commentEnd >= 0) {
            // 如果输出结果需要保留当前注释，则调用comment方法生成对应的注释节点
            if (options.shouldKeepComment) {
              options.comment(html.substring(4, commentEnd), index, index + commentEnd + 3)
            }
            // 模版解析指针右移3个单元，并跳出当前此循环，进行下一次循环
            advance(commentEnd + 3)
            continue
          }
        }

        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        // 如果是条件注释，则以条件注释的规则进行解析
        if (conditionalComment.test(html)) {
          // 获取符号 ']>' 在模版中的位置
          const conditionalEnd = html.indexOf(']>')

          // 如果符号 ']>' 在模版中存在，则说明当前段落为条件注释
          if (conditionalEnd >= 0) {
            // 模版解析指针右移2个单元，并跳出当前循环，进行下一次循环
            advance(conditionalEnd + 2)
            continue
          }
        }

        // Doctype:
        const doctypeMatch = html.match(doctype)
        // 如果是文档声明，则模版解析指针右移声明长度个单元，并跳出当前循环，进行下一次循环
        if (doctypeMatch) {
          advance(doctypeMatch[0].length)
          continue
        }

        // End tag:
        const endTagMatch = html.match(endTag)
        // 如果是结束标签，则按照结束标签规则进行解析
        if (endTagMatch) {
          // 声明变量 curIndex 保存当前模版解析指针
          const curIndex = index
          // 模版解析指针右移标签长度个单元
          advance(endTagMatch[0].length)
          // 根据结束标签生成对应的结束节点，并跳出当前循环，进行下一次循环
          parseEndTag(endTagMatch[1], curIndex, index)
          continue
        }

        // Start tag:
        // 如果是开始标签的话，按照开始标签的规则进行解析
        const startTagMatch = parseStartTag()
        if (startTagMatch) {
          // 解析开始标签中的属性
          handleStartTag(startTagMatch)
          // 如果需要忽略标签中的第一个换行，则解析指针右移1个单元
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1)
          }
          // 结束当前次循环，进行下一次循环
          continue
        }
      }

      // 符号 '<' 位于模版中，且不在开头位置，则将 '<' 之前的部分作为文本节点
      let text, rest, next
      if (textEnd >= 0) {
        // 循环当前模版的剩余部分，如果遇到文本内容，则将文本单独抽离出来
        rest = html.slice(textEnd)
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          // 如果模版段落内容既不是标签也不是注释，则认为当前段落是文本
          // 获取符号 '<' 在剩余文本中的位置，保存在 next 变量中
          next = rest.indexOf('<', 1)
          // 如果位置不存在，则认为剩余模版都是文本
          if (next < 0) break
          // 否则文本结束位置右移 next 个单元
          textEnd += next
          // 根据新的文本结束位置截短模版内容
          rest = html.slice(textEnd)
        }
        // 根据文本结束位置获取文本内容
        text = html.substring(0, textEnd)
      }

      // 如果不存在文本结束位置，则模版内容都是文本
      if (textEnd < 0) {
        text = html
      }

      // 如果文本内容不为空，则模版解析指针右移文本长度个单元
      if (text) {
        advance(text.length)
      }

      // chars 方法和文本内容 text 不为空，调用 chars 方法生成文本节点
      if (options.chars && text) {
        options.chars(text, index - text.length, index)
      }
    } else {
      // 如果当前内容在 'style/script/textarea' 中的话，则将标签中的所有内容当作文本
      // 初始化结束标签长度
      let endTagLength = 0
      // 获取栈顶的标签名
      const stackedTag = lastTag.toLowerCase()
      // 根据标签名创建结束标签的匹配正则表达式，缓存起来
      const reStackedTag = reCache[stackedTag] || (reCache[stackedTag] = new RegExp('([\\s\\S]*?)(</' + stackedTag + '[^>]*>)', 'i'))
      // 将结束标签之前的部分作为文本进行处理
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        // 保存结束标签的长度
        endTagLength = endTag.length
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
        }
        // 如果需要忽略第一个换行，则将模版解析指针右移1个单元
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1)
        }
        // 根据文本内容生成文本节点
        if (options.chars) {
          options.chars(text)
        }
        return ''
      })
      // 模版解析指针右移文本长度加结束标签长度个单元
      index += html.length - rest.length
      // 重置剩余模版
      html = rest
      // 根据结束标签生成结束节点
      parseEndTag(stackedTag, index - endTagLength, index)
    }

    // 如果模版长度没有变化，说明模版整体是文本内容，则根据模版生成文本节点，并跳出循环
    if (html === last) {
      options.chars && options.chars(html)
      if (process.env.NODE_ENV !== 'production' && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, { start: index + html.length })
      }
      break
    }
  }

  // Clean up any remaining tags
  // 清除模版中的剩余标签
  parseEndTag()

  /**
   * @name advance
   * @description 截短模版的方法
   * @param {number} n 指针右移的单元
   */
  function advance(n) {
    // 模版解析指针右移n个单元
    index += n
    // 模版截掉其第n个字符之前的部分
    html = html.substring(n)
  }

  /**
   * @name parseStartTag
   * @description 解析模版中开始标签的方法
   */
  function parseStartTag() {
    // 获取当前段落的开始标签的解析结果
    const start = html.match(startTagOpen)
    // 如果当前段落满足开始标签的解析规则，则生成开始标签解析结果
    if (start) {
      /**
       * @const {Record<string, any>} match
       * @description 初始化开始标签解析结果
       * @property {string} tagName 标签名
       * @property {RegExpMatchArray[]} attrs 标签属性解析结果
       * @property {number} start 标签解析开始位置
       * @property {number} end 标签解析结束位置
       * @property {'/'} unarySlash 单标签解析中的 '/' 符号
       */
      const match = {
        tagName: start[1],
        attrs: [],
        start: index
      }
      // 模版解析指针右移开始标签长度个单元
      advance(start[0].length)
      let end, attr
      // 循环开始标签中的属性，存入 match.attrs 中，匹配到开始标签的闭合符号'>'或没有属性可以解析时，结束循环
      while (!(end = html.match(startTagClose)) && (attr = html.match(dynamicArgAttribute) || html.match(attribute))) {
        // attr 匹配模版中的动态属性或普通属性
        // 将当前解析指针位置赋值给 attr 的 start 指针
        attr.start = index
        // 解析指针右移属性长度个单元
        advance(attr[0].length)
        // 将当前解析指针位置赋值给 attr 的 end 指针
        attr.end = index
        // 将 attr 属性存入 match.attrs 数组中
        match.attrs.push(attr)
      }
      // 属性解析结束后，处理闭合符号'>'，并返回开始标签解析结果
      if (end) {
        // 将单标签结束符号'/'赋值给 match.unarySlash
        match.unarySlash = end[1]
        // 解析指针右移结束符号长度个单元
        advance(end[0].length)
        // 将当前解析指针位置赋值给 match.end 指针
        match.end = index
        // 返回开始标签解析结果
        return match
      }
    }
  }

  /**
   * @name handleStartTag
   * @description 处理结束标签的处理结果
   * @param {Record<string, any>} match 开始标签解析结果
   */
  function handleStartTag(match) {
    /**
     * @const {string} tagName 开始标签名
     * @const {string} unarySlash 单标签结束符号 '/'
     */
    const tagName = match.tagName
    const unarySlash = match.unarySlash

    // 如果期望以 html 标签规则解析模版，则进行特殊解析
    if (expectHTML) {
      // 如果父节点标签是 p 标签，且当前开始标签不是文本段落标签（phrasing tag），则根据父节点标签生成结束节点
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        parseEndTag(lastTag)
      }
      // 如果父节点标签是自闭合双标签且与当前开始标签相同，则根据当前开始标签生成结束节点
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName)
      }
    }

    /**
     * @const {boolean} unary 当前开始标签是否是单标签
     */
    const unary = isUnaryTag(tagName) || !!unarySlash

    /**
     * @typedef Attr
     * @description 开始标签属性
     * @property {string} name 属性名
     * @property {string} value 属性值
     * @property {number} start 开始指针
     * @property {number} end 结束指针
     * 
     * @const {number} l 当前开始标签的属性列表长度
     * @const {Attr[]} attrs 当前开始标签的属性列表
     */
    const l = match.attrs.length
    const attrs = new Array(l)
    // 循环当前开始标签的属性列表，格式化属性内容
    for (let i = 0; i < l; i++) {
      /**
       * @const {RegExpMatchArray} args 属性参数
       * @const {string} value 属性值
       * @const {boolean} shouldDecodeNewlines 是否应该解码换行'\n'、'\t'等符号
       */
      const args = match.attrs[i]
      const value = args[3] || args[4] || args[5] || ''
      // 如果是 a 标签中的 href 属性，则需要根据 shouldDecodeNewlinesForHref 选项来判断是否需要解码换行
      const shouldDecodeNewlines = tagName === 'a' && args[1] === 'href'
        ? options.shouldDecodeNewlinesForHref
        : options.shouldDecodeNewlines
      // 格式化 attr 属性之后，将其重新插入 attrs 数组中指定的位置
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines)
      }
      // 如果设置了 outputSourceRange 选项，且当前为非生产模式，则为 attr 添加 start / end 指针
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length
        attrs[i].end = args.end
      }
    }

    // 如果当前开始标签不是单标签，则将当前开始标签解析结果压入标签解析栈，且将 lastTag 重置为当前开始标签
    if (!unary) {
      stack.push({ tag: tagName, lowerCasedTag: tagName.toLowerCase(), attrs: attrs, start: match.start, end: match.end })
      lastTag = tagName
    }

    // 如果提供了 start 函数，则调用该函数
    if (options.start) {
      options.start(tagName, attrs, unary, match.start, match.end)
    }
  }

  /**
   * @name parseEndTag
   * @description 解析结束标签的方法
   * @param {string} tagName 结束标签名
   * @param {number} start 结束标签开始位置
   * @param {number} end 结束标签结束位置
   */
  function parseEndTag(tagName, start, end) {
    /**
     * @const {number} pos 与结束标签匹配的开始标签在标签栈中的位置
     * @const {string} lowerCasedTagName 全字母小写的标签名
     */
    let pos, lowerCasedTagName
    // 结束标签开始位置不明确，则将当前解析指针位置赋予标签开始位置
    // 结束标签结束位置不明确，则将当前解析指针位置赋予标签结束位置
    if (start == null) start = index
    if (end == null) end = index

    // Find the closest opened tag of the same type
    // 如果提供了标签名，则根据标签名获取对应的开始标签位置
    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase()
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
    }
    // 如果没有提供标签名，则将开始标签位置为0
    else {
      // If no tag name is provided, clean shop
      pos = 0
    }

    // 如果有匹配标签或没有提供结束标签名，则将匹配标签的位置之后的开始标签或全部开始标签手动闭合
    if (pos >= 0) {
      // Close all the open elements, up the stack
      // 循环标签栈，在匹配标签位置停止
      // 在开发环境中给出警示信息，并根据开始标签生成结束标签节点
      for (let i = stack.length - 1; i >= pos; i--) {
        // 在开发环境中给出警示信息
        if (process.env.NODE_ENV !== 'production' &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(
            `tag <${stack[i].tag}> has no matching end tag.`,
            { start: stack[i].start, end: stack[i].end }
          )
        }
        // 根据开始标签生成结束标签节点
        if (options.end) {
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
      // 将匹配标签之后的开始标签全部弹出标签栈
      stack.length = pos
      // 重置 lastTag 的值
      lastTag = pos && stack[pos - 1].tag
    }
    // 如果没有匹配标签且结束标签是 br ，则以单标签开始标签的规则处理该标签
    else if (lowerCasedTagName === 'br') {
      // 创建 br 标签的单标签节点
      if (options.start) {
        options.start(tagName, [], true, start, end)
      }
    }
    // 如果没有匹配标签且结束标签是 p 标签，则生成一对 p 标签节点
    else if (lowerCasedTagName === 'p') {
      // 生成 p 标签开始标签节点
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      // 生成 p 标签结束标签节点
      if (options.end) {
        options.end(tagName, start, end)
      }
    }
  }
}
