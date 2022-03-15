/* @flow */

import { extend } from 'shared/util'
import { detectErrors } from './error-detector'
import { createCompileToFunctionFn } from './to-function'

export function createCompilerCreator(baseCompile: Function): Function {
  // baseOptions 平台相关的options
  // src/platforms/web/compiler/options.js中定义
  /**
   * @name createCompiler
   * @description 编译器生成函数
   */
  return function createCompiler(baseOptions: CompilerOptions) {
    /**
     * @name compile
     * @description 编译方法
     * @param {string} template 
     * @param {CompilerOptions} options 
     * @returns 编译后的结果（包含render的字符串形式代码）
     */
    function compile(
      template: string,
      options?: CompilerOptions
    ): CompiledResult {
      // 以内部选项为原型，创建最终选项
      const finalOptions = Object.create(baseOptions)
      // 创建错误信息队列
      const errors = []
      // 创建提示信息队列
      const tips = []

      // 创建提示方法
      let warn = (msg, range, tip) => {
        (tip ? tips : errors).push(msg)
      }

      // 如果存在用户选项，就把用户选项合并到最终选项
      if (options) {
        // 在开发环境中，改写警告方法
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          // $flow-disable-line
          const leadingSpaceLength = template.match(/^\s*/)[0].length

          warn = (msg, range, tip) => {
            const data: WarningMessage = { msg }
            if (range) {
              if (range.start != null) {
                data.start = range.start + leadingSpaceLength
              }
              if (range.end != null) {
                data.end = range.end + leadingSpaceLength
              }
            }
            (tip ? tips : errors).push(data)
          }
        }
        // merge custom modules
        // 合并内置选项和用户选项中的模块选项
        if (options.modules) {
          finalOptions.modules =
            (baseOptions.modules || []).concat(options.modules)
        }
        // merge custom directives
        // 合并内置选项和用户选项中的指令选项
        if (options.directives) {
          finalOptions.directives = extend(
            Object.create(baseOptions.directives || null),
            options.directives
          )
        }
        // copy other options
        // 对于其他选项，则用户选项替换掉内置选项
        for (const key in options) {
          if (key !== 'modules' && key !== 'directives') {
            finalOptions[key] = options[key]
          }
        }
      }
      // 为最终选项添加警告方法
      finalOptions.warn = warn

      // 将模板转化为渲染函数代码（字符串形式）
      const compiled = baseCompile(template.trim(), finalOptions)
      // 在开发环境中，检测编译结果的错误
      if (process.env.NODE_ENV !== 'production') {
        detectErrors(compiled.ast, warn)
      }
      // 将编译错误挂载到编译结果中
      compiled.errors = errors
      // 将提示信息挂载到编译结果中
      compiled.tips = tips
      // 返回编译结果
      return compiled
    }

    // 返回编译器
    return {
      compile,
      // 将模板编译为render函数
      compileToFunctions: createCompileToFunctionFn(compile)
    }
  }
}
