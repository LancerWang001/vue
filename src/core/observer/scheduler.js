/* @flow */

import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools,
  inBrowser,
  isIE
} from '../util/index'

export const MAX_UPDATE_COUNT = 100

const queue: Array<Watcher> = []
const activatedChildren: Array<Component> = []
let has: { [key: number]: ?true } = {}
let circular: { [key: number]: number } = {}
let waiting = false
let flushing = false
let index = 0

/**
 * Reset the scheduler's state.
 */
// 重置更新队列信息
function resetSchedulerState () {
	// 重置更新队列指针为0
	// 重置更新队列长度为0
	// 重置已更新子节点长度为0
  index = queue.length = activatedChildren.length = 0
	// 重置去重标识
  has = {}
	// 重置循环更新去重标识
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
	// 重置队列更新状态标识
  waiting = flushing = false
}

// Async edge case #6566 requires saving the timestamp when event listeners are
// attached. However, calling performance.now() has a perf overhead especially
// if the page has thousands of event listeners. Instead, we take a timestamp
// every time the scheduler flushes and use that for all event listeners
// attached during that flush.
export let currentFlushTimestamp = 0

// Async edge case fix requires storing an event listener's attach timestamp.
let getNow: () => number = Date.now

// Determine what event timestamp the browser is using. Annoyingly, the
// timestamp can either be hi-res (relative to page load) or low-res
// (relative to UNIX epoch), so in order to compare time we have to use the
// same timestamp type when saving the flush timestamp.
// All IE versions use low-res event timestamps, and have problematic clock
// implementations (#9632)
if (inBrowser && !isIE) {
  const performance = window.performance
  if (
    performance &&
    typeof performance.now === 'function' &&
    getNow() > document.createEvent('Event').timeStamp
  ) {
    // if the event timestamp, although evaluated AFTER the Date.now(), is
    // smaller than it, it means the event is using a hi-res timestamp,
    // and we need to use the hi-res version for event listener timestamps as
    // well.
    getNow = () => performance.now()
  }
}

/**
 * Flush both queues and run the watchers.
 */
// 执行更新队列
function flushSchedulerQueue () {
	// 获取当前时间戳
  currentFlushTimestamp = getNow()
	// 将正在刷新标识置为true
  flushing = true
	// 声明watcher和id
  let watcher, id

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child)
  // 2. A component's user watchers are run before its render watcher (because
  //    user watchers are created before the render watcher)
  // 3. If a component is destroyed during a parent component's watcher run,
  //    its watchers can be skipped.
	/**
	 * 在刷新前对更新队列进行排序的目的：
	 * 1. 保证父组件在子组件之前更新，因为父组件一定在子组件之前创建
	 * 2. 保证用户自定义的watcher在渲染watcher之前执行，因为自定义watcher一定在渲染watcher之前创建
	 * 3. 如果在父组件watcher执行更新时，子组件销毁了，那么子组件的watcher将会被忽略
	 */
	// 对更新队列按照watcher.id进行排序
  queue.sort((a, b) => a.id - b.id)

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
	// 遍历更新队列queue，动态获取队列长度，因为在遍历队列时，长度有可能会变化
  for (index = 0; index < queue.length; index++) {
		// 初始化当前watcher
    watcher = queue[index]
		// 获取watcher的before函数，在更新前执行before函数
    if (watcher.before) {
      watcher.before()
    }
		// 获取watcher的id
    id = watcher.id
		// 将watcher的去重标识置为空
    has[id] = null
		// 执行watcher的更新操作
    watcher.run()
    // in dev build, check and stop circular updates.
		// 在开发环境中，防止watcher发生无限递归更新，即在watcher执行更新时继续添加当前watcher
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
			// 为当前watcher添加循环更新去重标识
      circular[id] = (circular[id] || 0) + 1
			// 如果重复更新超过100次，则弹出提示信息，并强制中断更新
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' + (
            watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`
          ),
          watcher.vm
        )
				// 中断执行更新
        break
      }
    }
  }

  // keep copies of post queues before resetting state
	// 保存队列中执行更新的组件（Vue实例）
  const activatedQueue = activatedChildren.slice()
	// 保存更新队列为旧更新队列
  const updatedQueue = queue.slice()

	// 重置当前更新队列
  resetSchedulerState()

  // call component updated and activated hooks
	// 触发vm的activated钩子
  callActivatedHooks(activatedQueue)
	// 触发vm的updated钩子
  callUpdatedHooks(updatedQueue)

  // devtool hook
  /* istanbul ignore if */
	// 如果在浏览器环境中，且加载了vue devtools，则触发vue devtools的flush钩子
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

function callUpdatedHooks (queue) {
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    if (vm._watcher === watcher && vm._isMounted && !vm._isDestroyed) {
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent (vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 */
// 参数：watcher: Watcher 当前要处理的watcher对象
export function queueWatcher (watcher: Watcher) {
	// 获取当前watcher的id属性
  const id = watcher.id
	// 判断当前watcher是否已经被处理，防止watcher被重复处理
  if (has[id] == null) {
		// 将当前watcher的去重标识置为true，标识watcher已经被处理过了
    has[id] = true
		// 判断处理队列是否正在刷新，即队列是否正在执行
		// 如果没有在执行，则将watcher插入队列尾部
    if (!flushing) {
      queue.push(watcher)
    }
		// 否则根据watcher的id值，插入队列中指定的位置
		else {
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.
			// 更新队列中的watcher都是按照id大小从小到大进行排序的
			// watcher必须根据其id大小插入到更新队列指定的位置，以保持队列的有序
			// watcher在执行插入操作时，队列正在进行刷新，所以要插入到当前刷新位置之后，否则不会执行run
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
			// watcher插入队列
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
		// 如果当前更新队列正在执行，则跳过，否则执行队列中的更新
    if (!waiting) {
			// 将等待标识置为true
      waiting = true
			// 开发环境中并且非异步，立即调用`flushSchedulerQueue`执行队列内容
      if (process.env.NODE_ENV !== 'production' && !config.async) {
        flushSchedulerQueue()
        return
      }
			// 否则在当前事件循环结束之前调用`flushSchedulerQueue`执行队列内容
      nextTick(flushSchedulerQueue)
    }
  }
}
