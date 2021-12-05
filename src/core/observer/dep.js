/* @flow */

import type Watcher from './watcher'
import { remove } from '../util/index'
import config from '../config'

let uid = 0

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 */
export default class Dep {
  static target: ?Watcher;
  id: number;
  subs: Array<Watcher>;

  constructor () {
    this.id = uid++
    this.subs = []
  }

  addSub (sub: Watcher) {
    this.subs.push(sub)
  }

  removeSub (sub: Watcher) {
    remove(this.subs, sub)
  }

  // 将依赖添加至依赖目标watcher中
  depend () {
    // 如果依赖目标存在，将依赖添加至依赖目标中
    if (Dep.target) {
      Dep.target.addDep(this)
    }
  }

  // 向订阅者（依赖目标）派发通知
  notify () {
    // stabilize the subscriber list first
    // 浅拷贝订阅者数组
    const subs = this.subs.slice()
    // 如果是开发模式且不是异步模式，则将订阅者按照id进行排序
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    // 提示订阅者进行更新
    // 遍历订阅者数组，执行订阅者的update方法
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
}

// The current target watcher being evaluated.
// This is globally unique because only one watcher
// can be evaluated at a time.
// Dep.target是存放目前正在使用的Watcher
// 该属性是全局唯一，即当前只有一个Watcher被使用
Dep.target = null
// targetStack是为了在递归添加依赖的时候，记录父响应式对象中的Watcher
const targetStack = []

// 设置当前Dep.target，并将该依赖目标推入目标栈
export function pushTarget (target: ?Watcher) {
  // 将依赖目标推入栈中
  targetStack.push(target)
  // 设置当前依赖目标
  Dep.target = target
}

// 将当前依赖目标从目标栈中弹出，并恢复至上一帧中的目标对象
export function popTarget () {
  // 将当前依赖目标从目标栈中弹出
  targetStack.pop()
  // 将当前依赖目标恢复至上一个依赖目标
  Dep.target = targetStack[targetStack.length - 1]
}
