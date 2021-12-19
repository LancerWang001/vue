/* @flow */

import config from 'core/config'
import { warn, cached } from 'core/util/index'
import { mark, measure } from 'core/util/perf'

import Vue from './runtime/index'
import { query } from './util/index'
import { compileToFunctions } from './compiler/index'
import { shouldDecodeNewlines, shouldDecodeNewlinesForHref } from './util/compat'

const idToTemplate = cached(id => {
  const el = query(id)
  return el && el.innerHTML
})

const mount = Vue.prototype.$mount
// 初始化dom树，添加编译模板的功能
Vue.prototype.$mount = function (
  el?: string | Element,
  hydrating?: boolean
): Component {
  // 获取项目根节点
  el = el && query(el)

  /* istanbul ignore if */
  // 项目根节点不能是document.body或html根元素
  if (el === document.body || el === document.documentElement) {
    process.env.NODE_ENV !== 'production' && warn(
      `Do not mount Vue to <html> or <body> - mount to normal elements instead.`
    )
    return this
  }

  // 获取选项options
  const options = this.$options
  // resolve template/el and convert to render function
  // 选项中没有传递render的情况下，将模板编译为render函数
  if (!options.render) {
    // 获取选项中的模板内容
    let template = options.template
    // 如果传递了template，则将template转换为render函数
    if (template) {
      // 如果template是字符串类型，则检查template是否是id选择器
      if (typeof template === 'string') {
        // 如果template以#开头，则将template作为id选择器
        if (template.charAt(0) === '#') {
          // 将template作为id选择器获取对应的dom元素
          template = idToTemplate(template)
          /* istanbul ignore if */
          if (process.env.NODE_ENV !== 'production' && !template) {
            warn(
              `Template element not found or is empty: ${options.template}`,
              this
            )
          }
        }
      }
      // 如果template是元素节点，则将元素节点的内容赋值给template变量
      else if (template.nodeType) {
        template = template.innerHTML
      }
      // 否则在在开发环境提示警告信息，并且直接返回
      else {
        if (process.env.NODE_ENV !== 'production') {
          warn('invalid template option:' + template, this)
        }
        return this
      }
    }
    // 否则获取根节点元素的序列化文本作为template
    else if (el) {
      template = getOuterHTML(el)
    }
    if (template) {
      /* istanbul ignore if */
      // 在开发环境为性能检测工具做标记
      if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
        mark('compile')
      }

      // 调用compileToFunctions将template转换为render函数
      const { render, staticRenderFns } = compileToFunctions(template, {
        outputSourceRange: process.env.NODE_ENV !== 'production',
        shouldDecodeNewlines,
        shouldDecodeNewlinesForHref,
        delimiters: options.delimiters,
        comments: options.comments
      }, this)
      // 将render函数挂载到options上
      options.render = render
      // 将staticRender函数挂载到options上
      options.staticRenderFns = staticRenderFns

      /* istanbul ignore if */
      // 在开发环境中为性能检测工具做标记
      if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
        mark('compile end')
        measure(`vue ${this._name} compile`, 'compile', 'compile end')
      }
    }
  }
  // 挂载render函数的渲染结果
  return mount.call(this, el, hydrating)
}

/**
 * Get outerHTML of elements, taking care
 * of SVG elements in IE as well.
 */
function getOuterHTML (el: Element): string {
  if (el.outerHTML) {
    return el.outerHTML
  } else {
    const container = document.createElement('div')
    container.appendChild(el.cloneNode(true))
    return container.innerHTML
  }
}

Vue.compile = compileToFunctions

export default Vue
