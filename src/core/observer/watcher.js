/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  invokeWithErrorHandling,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component; // 当前Vue组件实例
  expression: string; // 订阅函数`expOrFn`的描述
  cb: Function; // 订阅更新之后的订阅函数
  id: number; // 当前观察者的id
  deep: boolean; // 是否对值`value`进行深层订阅
  user: boolean; // 是否是用户传入的`Watcher`
  lazy: boolean; // 是否是延迟执行的`Watcher`
  sync: boolean; // 是否是同步执行的`Watcher`
  dirty: boolean; // `Watcher`的依赖是否发生了改变
  active: boolean; // 当前`Watcher`是否活跃
  deps: Array<Dep>; // 上一次更新的依赖数组
  newDeps: Array<Dep>; // 新更新的依赖数组
  depIds: SimpleSet; // 上一次更新的依赖id集合
  newDepIds: SimpleSet; // 新更新的依赖id集合
  before: ?Function; // 订阅更新前执行的方法
  getter: Function; // 订阅更新时执行的方法
  value: any; // 当前订阅值

  constructor (
    vm: Component, // 当前Vue组件实例
    expOrFn: string | Function, // 订阅更新时执行的方法
    cb: Function, // 订阅更新后执行的回调函数
    options?: ?Object, // watcher配置选项
    isRenderWatcher?: boolean // 是否是用于渲染的`Watcher`
  ) {
    // 将参数中的vm赋值给this.vm
    this.vm = vm
    // 如果是订阅渲染的watcher，则将该watcher添加至vm._watcher
    if (isRenderWatcher) {
      vm._watcher = this
    }
    // 将watcher添加至vm的watcher数组
		// 计算属性和侦听器也会加入其中
    vm._watchers.push(this)
    // options
    // 从参数options中获取watcher标识
    if (options) {
      // 获取深层订阅标识
      this.deep = !!options.deep
      // 获取自定义watcher标识
      this.user = !!options.user
      // 获取延迟执行标识
      this.lazy = !!options.lazy
      // 获取同步执行标识
      this.sync = !!options.sync
      // 获取订阅更新前执行方法
      this.before = options.before
    } else {
      // 否则将深层订阅、自定义watcher、延迟执行、同步标识重置为false
      this.deep = this.user = this.lazy = this.sync = false
    }
    // 从参数中获取订阅更新后执行方法
    this.cb = cb
    // 获取watcher的id编号
    this.id = ++uid // uid for batching
    // 初始化活跃配置为true
    this.active = true
    // 初始化依赖变化标识为延迟执行的标识
    this.dirty = this.lazy // for lazy watchers
    // 初始化旧订阅依赖数组为空数组
    this.deps = []
    // 初始化新订阅依赖数组为空数组
    this.newDeps = []
    // 初始化旧订阅依赖id集合为空集合
    this.depIds = new Set()
    // 初始化新订阅依赖id集合为空集合
    this.newDepIds = new Set()
    // 获取订阅描述
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    // 获取订阅更新时执行的方法`getter`
    // 如果参数中expOrFn存在，则将expOrFn赋值给`this.getter`
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    }
    // 否则从this.vm中获取对应的方法，赋值给`this.getter`
    else {
      // this.vm中获取对应的方法，赋值给`this.getter`
			// parsePath('person.name') => { watch: { 'person.name': function () {} } }
      this.getter = parsePath(expOrFn)
      // 如果获取不到getter，则将订阅更新执行方法赋值为空函数，并给予开发警告
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    // 初始化订阅值value
    this.value = this.lazy
    // 如果是延迟执行，则初始化为undefined
      ? undefined
    // 否则调用this.get获取getter的返回值
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  // 执行订阅更新方法，并重新收集依赖
  get () {
    // 将当前watcher推入依赖目标栈中，并将当前依赖目标指向当前watcher
    pushTarget(this)
    // 创建订阅值
    let value
    // 从watcher.vm中获取vm对象
    const vm = this.vm
    try {
      // 传入vm执行订阅更新方法，接收其返回值为订阅值
      value = this.getter.call(vm, vm)
    } catch (e) {
      // 如果更新失败，则处理错误
      // 如果是自定义watcher，则执行专门的处理
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        // 如果不是自定义watcher，则抛出错误
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      // 如果需要深层订阅，则递归订阅值进行深层订阅
      if (this.deep) {
        traverse(value)
      }
      // 将当前watcher对象弹出依赖目标栈，将当前依赖目标恢复至上一个响应式对象的依赖目标
      popTarget()
      // 将当前依赖保存至旧依赖记录中，并清空当前依赖
      this.cleanupDeps()
    }
    // 返回订阅值
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  // 将watcher添加到dep依赖
  addDep (dep: Dep) {
    // 获取依赖id
    const id = dep.id
    // 如果新依赖中没有当前依赖，则将watcher添加至当前依赖
    if (!this.newDepIds.has(id)) {
      // 将依赖id记录到watcher的新依赖id集合中
      this.newDepIds.add(id)
      // 将依赖记录到watcher的新依赖数组中
      this.newDeps.push(dep)
      // 如果依赖没有被旧依赖数组添加过，则将watcher添加至依赖
      if (!this.depIds.has(id)) {
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  // 清空/重置watcher的依赖
  cleanupDeps () {
    // 遍历watcher旧依赖数组
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      // 如果新依赖数组没有该旧依赖，则从旧依赖订阅者数组中删除当前watcher
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
		// => 交换新依赖与旧依赖，并清空旧依赖
    // 将新依赖数组赋值给旧依赖数组
    // 将新依赖数组清空
    // 将新依赖id集合赋值给旧依赖id集合
    // 将新依赖id集合清空
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  // 订阅更新后执行的更新操作
  update () {
    /* istanbul ignore else */
    // 如果是延迟执行，则将依赖改变标识置为true
    if (this.lazy) {
      this.dirty = true
    }
    // 如果watcher是同步执行，则立即执行当前更新
    else if (this.sync) {
      this.run()
    }
    // 否则将watcher推入执行队列进行异步执行
    else {
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  // 立即执行订阅更新方法的执行操作，会被scheduler调用
  run () {
    // 如果当前watcher处于活跃状态，则立即执行更新方法
    if (this.active) {
      // 执行this.get，获取更新后的订阅值
			// 在渲染watcher中，订阅值value的值为空
			// 在计算watcher和自定义watcher中，value是有具体值的
      const value = this.get()
      // 如果订阅值发生变化，或新值是对象或设置了深层订阅标识，则替换旧订阅值
      if (
        // 订阅值发生变化
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        // 新订阅值是对象
        isObject(value) ||
        // watcher设置了深层订阅
        this.deep
      ) {
        // set new value
        // 保存旧订阅值
        const oldValue = this.value
        // 将订阅值替换为新订阅值
        this.value = value
        // 调用订阅更新后的回调函数this.cb
        if (this.user) {
          // 如果是自定义watcher，则执行专门的回调执行方法
					// 防止自定义watcher报错导致页面崩溃
          const info = `callback for watcher "${this.expression}"`
          invokeWithErrorHandling(this.cb, this.vm, [value, oldValue], this.vm, info)
        } else {
          // 如果不是自定义的watcher，则用this.vm调用this.cb，并传入新订阅值和旧订阅值
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  // 延迟执行更新的方法
  evaluate () {
    // 调用`this.get`执行更新，并将返回值作为订阅值
    this.value = this.get()
    // 重置依赖变化表示为false
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  // 将当前watcher添加到依赖对象的订阅数组中
  depend () {
    // 遍历旧依赖数组
    let i = this.deps.length
    while (i--) {
      // 将当前订阅者watcher添加至每一个依赖的订阅者数组中
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  // 将当前订阅者watcher从所有依赖的订阅者数组中删除
  teardown () {
    // 如果当前watcher处于活跃状态，则从依赖中删除当前订阅者，否则直接返回
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      // 如果当前Vue组件没有销毁，则将当前watcher从vm._watchers数组中删除
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      // 遍历旧依赖数组
      let i = this.deps.length
      while (i--) {
        // 将当前watcher订阅者从所有依赖订阅者数组中删除
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
