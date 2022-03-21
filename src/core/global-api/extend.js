/* @flow */

import { ASSET_TYPES } from 'shared/constants'
import { defineComputed, proxy } from '../instance/state'
import { extend, mergeOptions, validateComponentName } from '../util/index'

/**
 * @name initExtend
 * @description 为 Vue 构造函数添加静态的 extend 方法
 * @param {GlobalAPI} Vue Vue 全局接口对象
 */
export function initExtend(Vue: GlobalAPI) {
  /**
   * Each instance constructor, including Vue, has a unique
   * cid. This enables us to create wrapped "child
   * constructors" for prototypal inheritance and cache them.
   */
  /*
   * 每个实例构造函数，包括 Vue，都有一个唯一的 cid。 这使我们能够为原型继承创建包装的“子构造函数”并缓存它们。
   */
  // Vue 构造函数的 cid 为 0
  Vue.cid = 0
  // 其他 Vue 的子类构造函数的 cid 从 1 开始
  let cid = 1

  /**
   * Class inheritance
   */
  /**
   * @name extend
   * @description 创建 Vue 的子类构造函数并返回
   * @param {Object} extendOptions 继承选项
   * @returns 子类构造函数
   */
  Vue.extend = function (extendOptions: Object): Function {
    extendOptions = extendOptions || {}
    /**
     * @const {Function} Super 父类构造函数
     * @const {number} SuperId 父类构造函数的cid
     * @const {Record<string, Function>} 子类构造函数缓存上下文
     */
    const Super = this
    const SuperId = Super.cid
    // 从继承选项的 _Ctor 属性中获取缓存对象
    const cachedCtors = extendOptions._Ctor || (extendOptions._Ctor = {})
    // 优先从缓存对象中加载组件构造函数，如果缓存中存在，则直接返回该构造函数
    if (cachedCtors[SuperId]) {
      return cachedCtors[SuperId]
    }

    // 获取组件构造函数的名称，如果组件构造函数名为空，则获取父类的构造函数
    const name = extendOptions.name || Super.options.name
    // 如果组件名不为空，则在开发环境中校验组件名是否合法
    if (process.env.NODE_ENV !== 'production' && name) {
      validateComponentName(name)
    }

    // 创建组件构造函数，在函数内部调用了 _init(options)
    const Sub = function VueComponent(options) {
      this._init(options)
    }
    // 以父类构造函数原型为原型创建空对象
    // 将该对象作为组件的原型对象
    Sub.prototype = Object.create(Super.prototype)
    // 将组件原型中的 constructor 指向组件构造函数
    Sub.prototype.constructor = Sub
    // 为组件添加 cid，cid自增
    Sub.cid = cid++
    // 为组件添加 options 选项，即合并了父类选项与继承选项的的对象
    Sub.options = mergeOptions(
      Super.options,
      extendOptions
    )
    // 将组件的 super 指针指向父类
    Sub['super'] = Super

    // For props and computed properties, we define the proxy getters on
    // the Vue instances at extension time, on the extended prototype. This
    // avoids Object.defineProperty calls for each instance created.
    // 添加选项中 props 的初始化方法
    if (Sub.options.props) {
      initProps(Sub)
    }
    // 添加选项中 computed 的初始化方法
    if (Sub.options.computed) {
      initComputed(Sub)
    }

    // allow further extension/mixin/plugin usage
    // 为组件构造函数添加静态方法 extend、mixin、use
    Sub.extend = Super.extend
    Sub.mixin = Super.mixin
    Sub.use = Super.use

    // create asset registers, so extended classes
    // can have their private assets too.
    // 为组件构造函数添加静态资源注册方法
    ASSET_TYPES.forEach(function (type) {
      Sub[type] = Super[type]
    })
    // enable recursive self-lookup
    // 将组件本身添加到其 options.components 组件上下文对象中
    if (name) {
      Sub.options.components[name] = Sub
    }

    // keep a reference to the super options at extension time.
    // later at instantiation we can check if Super's options have
    // been updated.
    // 为组件构造函数添加父类选项 superOptions
    Sub.superOptions = Super.options
    // 为组件构造函数添加继承选项 extendOptions
    Sub.extendOptions = extendOptions
    // 为组件构造函数添加原始不可变选项 sealedOptions
    Sub.sealedOptions = extend({}, Sub.options)

    // cache constructor
    // 将组件构造函数缓存到继承选项的 _Ctor 属性中
    cachedCtors[SuperId] = Sub
    // 返回组件构造函数
    return Sub
  }
}

function initProps(Comp) {
  const props = Comp.options.props
  for (const key in props) {
    proxy(Comp.prototype, `_props`, key)
  }
}

function initComputed(Comp) {
  const computed = Comp.options.computed
  for (const key in computed) {
    defineComputed(Comp.prototype, key, computed[key])
  }
}
