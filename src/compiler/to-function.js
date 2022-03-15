/* @flow */

import { noop, extend } from 'shared/util'
import { warn as baseWarn, tip } from 'core/util/debug'
import { generateCodeFrame } from './codeframe'

type CompiledFunctionResult = {
  render: Function;
  staticRenderFns: Array<Function>;
};

function createFunction(code, errors) {
  try {
    return new Function(code)
  } catch (err) {
    errors.push({ err, code })
    return noop
  }
}

// 编译函数生成器函数
export function createCompileToFunctionFn(compile: Function): Function {
  // 创建缓存对象
  const cache = Object.create(null)

  /**
   * @name compileToFunctions
   * @description 将模版编译为render函数
   * @param {string} template 模板
   * @param {CompilerOptions} options 编译选项
   * @param {Component} vm Vue实例
   * @return {CompiledFunctionResult} 返回render/staticRenderFns函数
   */
  return function compileToFunctions(
    template: string,
    options?: CompilerOptions,
    vm?: Component
  ): CompiledFunctionResult {
    // 浅拷贝选项对象options
    options = extend({}, options)
    // 获取log方法
    const warn = options.warn || baseWarn
    // 删除选项中的log方法
    delete options.warn

    /* istanbul ignore if */
    // 在开发环境中检测是否存在CSP限制
    if (process.env.NODE_ENV !== 'production') {
      // detect possible CSP restriction
      try {
        new Function('return 1')
      } catch (e) {
        if (e.toString().match(/unsafe-eval|CSP/)) {
          warn(
            'It seems you are using the standalone build of Vue.js in an ' +
            'environment with Content Security Policy that prohibits unsafe-eval. ' +
            'The template compiler cannot work in this environment. Consider ' +
            'relaxing the policy to allow unsafe-eval or pre-compiling your ' +
            'templates into render functions.'
          )
        }
      }
    }

    // check cache
    // 生成渲染函数缓存的key：`${options.delimiters}${template}`
    const key = options.delimiters
      ? String(options.delimiters) + template
      : template
    // 如果缓存中存在指定的渲染函数，则直接返回该渲染函数
    if (cache[key]) {
      return cache[key]
    }

    // compile
    // 将template模板编译为渲染函数代码片段
    const compiled = compile(template, options)

    // check compilation errors/tips
    // 在开发环境中，如果编译过程中有错误或警告，将错误和警告打印出来
    if (process.env.NODE_ENV !== 'production') {
      if (compiled.errors && compiled.errors.length) {
        if (options.outputSourceRange) {
          compiled.errors.forEach(e => {
            warn(
              `Error compiling template:\n\n${e.msg}\n\n` +
              generateCodeFrame(template, e.start, e.end),
              vm
            )
          })
        } else {
          warn(
            `Error compiling template:\n\n${template}\n\n` +
            compiled.errors.map(e => `- ${e}`).join('\n') + '\n',
            vm
          )
        }
      }
      if (compiled.tips && compiled.tips.length) {
        if (options.outputSourceRange) {
          compiled.tips.forEach(e => tip(e.msg, vm))
        } else {
          compiled.tips.forEach(msg => tip(msg, vm))
        }
      }
    }

    // turn code into functions
    // 创建渲染函数命名空间
    const res = {}
    // 初始化错误堆栈
    const fnGenErrors = []
    // 将render函数的代码片段（字符串形式的js代码）转化为函数，并添加进命名空间
    res.render = createFunction(compiled.render, fnGenErrors)
    // 将staticRenderFns的代码片段转化为函数，并添加进命名空间
    res.staticRenderFns = compiled.staticRenderFns.map(code => {
      return createFunction(code, fnGenErrors)
    })

    // check function generation errors.
    // this should only happen if there is a bug in the compiler itself.
    // mostly for codegen development use
    /* istanbul ignore if */
    // 在开发环境中检查代码片段转为函数过程中的错误，并打印出来
    if (process.env.NODE_ENV !== 'production') {
      if ((!compiled.errors || !compiled.errors.length) && fnGenErrors.length) {
        warn(
          `Failed to generate render function:\n\n` +
          fnGenErrors.map(({ err, code }) => `${err.toString()} in\n\n${code}\n`).join('\n'),
          vm
        )
      }
    }

    // 将渲染函数的命名空间对象添加进缓存，并返回该命名空间
    return (cache[key] = res)
  }
}
