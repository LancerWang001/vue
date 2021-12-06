/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from '../util/index'

// 利用数组原型创建一个新的数组对象
const arrayProto = Array.prototype
export const arrayMethods = Object.create(arrayProto)
// 拦截数组的原生方法
const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 */
// 拦截数组中的指定方法，将参数转为转为响应式数据，并向值的订阅者派发更新通知
methodsToPatch.forEach(function (method) {
  // cache original method
  // 获取数组的原生方法
  const original = arrayProto[method]
  // 向自定义数组原型中添加拦截后的方法
  def(arrayMethods, method, function mutator (...args) {
    // 调用原生数组方法，保存执行的结果
    const result = original.apply(this, args)
    // 获取响应式数组的观察者对象
    const ob = this.__ob__
    // 初始化方法参数列表
    let inserted
    // 给方法参数列表赋值
    switch (method) {
      // 拦截到`push`和`unshift`方法时，将全部参数赋值给参数列表
      case 'push':
      case 'unshift':
        inserted = args
        break
      // 拦截到splice方法时，只将第二个参数以后的参数赋值给参数列表
      case 'splice':
        inserted = args.slice(2)
        break
    }
    // 如果参数列表不为空，则为列表中所有的参数添加订阅
    if (inserted) ob.observeArray(inserted)
    // notify change
    // 向响应式数组的所有订阅者派发更新通知
    ob.dep.notify()
    // 返回原生方法调用的结果
    return result
  })
})
