/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  // 观察对象
  value: any;
  // 依赖对象
  dep: Dep;
  // 实例计数器
  vmCount: number; // number of vms that have this object as root $data

  // 构造函数
  constructor (value: any) {
    // 从构造函数参数中获得观察对象value
    this.value = value
    // 新建依赖对象
    this.dep = new Dep()
    // 初始化依赖计数器为0
    this.vmCount = 0
    // 将当前观察者对象挂载到`value.__ob__`上
    def(value, '__ob__', this)

    // 判断value是否是数组
    // 如果是数组：
    if (Array.isArray(value)) {
        // 如果浏览器支持__proto__属性
      if (hasProto) {
        // 替换value的原型属性，添加自定义的数组方法
        protoAugment(value, arrayMethods)
      } else {
				// 将拦截过的数组原生方法挂载到响应式对象上
        copyAugment(value, arrayMethods, arrayKeys)
      }
      // 为数组中的每一个方法创建一个observer实例
      this.observeArray(value)
    }
    // 如果不是数组
    else {
      // 遍历对象中的每一个属性，转换成`setter/getter`
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk (obj: Object) {
    // 获取观察对象的每一个属性
    const keys = Object.keys(obj)
    // 遍历每一个属性，设置为响应式数据
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment (target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  // 判断value是否是对象或者是VNode的实例，否则直接返回
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  // 创建观察者对象
  let ob: Observer | void
  // 如果value是响应式对象，则将value中的__ob__取出赋值给观察者对象
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  }
  // 满足一定条件，新建观察者对象
  else if (
    // 观察者模式开关打开
    shouldObserve &&
    // 当前非服务端渲染
    !isServerRendering() &&
    // value是数组或普通对象
    (Array.isArray(value) || isPlainObject(value)) &&
    // value可扩展
    Object.isExtensible(value) &&
    // value不是Vue实例
    !value._isVue
  ) {
    // 创建value的观察者对象
    ob = new Observer(value)
  }
  // 如果value是RootData，ob.vmCount自增
  if (asRootData && ob) {
    ob.vmCount++
  }
  // 返回观察者对象ob
  return ob
}

/**
 * Define a reactive property on an Object.
 */
export function defineReactive (
  obj: Object, // 目标对象
  key: string, // 将要转换的属性
  val: any, // 属性的值
  customSetter?: ?Function, // 自定义`setter`
  shallow?: boolean // 不将子属性转为响应式属性
) {
  // 为每一个响应式对象obj的每一个属性创建依赖对象
  const dep = new Dep()

  // 获取属性的属性描述符
  const property = Object.getOwnPropertyDescriptor(obj, key)
  // 如果该属性是不可配置属性，则返回
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  // 获取属性存储器函数`setter`/`getter`
  const getter = property && property.get
  const setter = property && property.set
  // 满足以下条件，属性的值从`obj[key]`中获取
  // 1. 属性没有设置getter或有`setter`
  // 2. 只传递了`obj`和`key`
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }

  // 如果需要递归观察子属性，则将子属性转化为响应式对象，并接收子属性的观察者对象
  let childOb = !shallow && observe(val)

  // 将当前属性转化为响应式属性
  Object.defineProperty(obj, key, {
    // 设置属性为可枚举属性
    enumerable: true,
    // 设置属性为可配置属性
    configurable: true,
    // 添加`getter`取值器
    get: function reactiveGetter () {
      // 获取属性值
      // 如果已存在`getter`，则用`obj`调用`getter`获取`value`
      // 如果不存在`getter`，则使用计算后的`val`
      const value = getter ? getter.call(obj) : val
      // 如果存在当前依赖目标，即`watcher`对象，则建立依赖
      if (Dep.target) {
        // 将依赖目标`watcher`添加到该属性key的依赖对象dep上
        dep.depend()
        // 如果子属性的值也是响应式对象，则将依赖目标添加到子属性值的依赖对象val.__ob__上
        if (childOb) {
          // 将依赖目标添加到子属性值的依赖对象上
          childOb.dep.depend()
          // 如果当前属性值是数组，则递归将数组中的每一个成员的依赖目标添加到依赖对象上
          if (Array.isArray(value)) {
            // 递归将数组中的每一个成员的依赖目标添加到依赖对象上
            dependArray(value)
          }
        }
      }
      // 返回属性值
      return value
    },
    // 添加setter存储器
    set: function reactiveSetter (newVal) {
      // 获取当前属性值
      // 如果getter存在，则用obj调用getter获取value
      // 如果getter不存在，则使用计算后的val
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      // 如果新值与当前属性值不同或者新值/当前值为NaN，则立即返回
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      // 在开发环境中调用自定义的存储器函数
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      // 如果存在取值器，且不存在存储器，则直接返回
      // #7981: for accessor properties without setter
      if (getter && !setter) return
      // 如果存在setter函数，则使用obj调用setter，并传入新值
      if (setter) {
        setter.call(obj, newVal)
      }
      // 否则将新值赋予当前属性值
      else {
        val = newVal
      }
      // 如果没有设置浅层响应，则将新值转为响应式
      childOb = !shallow && observe(newVal)
      // 向依赖目标派发更新通知
      dep.notify()
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  if (!ob) {
    target[key] = val
    return val
  }
  defineReactive(ob.value, key, val)
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) {
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
