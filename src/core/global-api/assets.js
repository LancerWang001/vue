/* @flow */

import { ASSET_TYPES } from 'shared/constants'
import { isPlainObject, validateComponentName } from '../util/index'

/**
 * @name initAssetRegisters
 * @description 添加获取 Vue 全局资源的方法
 * @param {GlobalAPI} Vue Vue 全局方法集
 */
export function initAssetRegisters(Vue: GlobalAPI) {
  /**
   * Create asset registration methods.
   */
  ASSET_TYPES.forEach(type => {
    /**
     * @name anonymous
     * @description 获取 Vue 全局资源的方法
     * @param {string} id 资源名
     * @param {Function | Object} definition 资源定义
     * @returns {Function | Object | void} 资源
     */
    Vue[type] = function (
      id: string,
      definition: Function | Object
    ): Function | Object | void {
      // 如果在调用时没有传递 definition 资源定义参数，说明只是为了取值
      if (!definition) {
        return this.options[type + 's'][id]
      }
      // 否则认为是赋值操作
      else {
        /* istanbul ignore if */
        // 如果在开环境中调用 components 方法，则对组件的名称进行校验
        if (process.env.NODE_ENV !== 'production' && type === 'component') {
          validateComponentName(id)
        }
        // 如果调用的是 components 方法且资源定义是对象格式，则根据资源定义创建 Vue 的子类构造函数
        if (type === 'component' && isPlainObject(definition)) {
          // 将资源对象没有名称，则将参数中的资源名 id 赋值给资源对象的资源名 name
          definition.name = definition.name || id
          // 根据资源定义对象创建 Vue 的子类构造函数，覆盖原本的资源定义
          definition = this.options._base.extend(definition)
        }
        // 如果调用的是 directives 方法且资源定义是函数，则根据资源定义创建指令对象
        if (type === 'directive' && typeof definition === 'function') {
          // 根据资源定义创建指令对象，覆盖原本的资源定义
          definition = { bind: definition, update: definition }
        }
        // 将处理过的资源定义赋值给 Vue 中指定的资源集
        this.options[type + 's'][id] = definition
        // 返回资源定义
        return definition
      }
    }
  })
}
