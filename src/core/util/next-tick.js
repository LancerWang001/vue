/* @flow */
/* globals MutationObserver */

import { noop } from 'shared/util'
import { handleError } from './error'
import { isIE, isIOS, isNative } from './env'

export let isUsingMicroTask = false

const callbacks = []
let pending = false

// 刷新任务队列，执行队列中所有的任务
function flushCallbacks () {
	// 将等待标识置为false
  pending = false
	// 浅拷贝任务队列
  const copies = callbacks.slice(0)
	// 清空当前任务队列
  callbacks.length = 0
	// 顺序执行所有的任务
  for (let i = 0; i < copies.length; i++) {
    copies[i]()
  }
}

// Here we have async deferring wrappers using microtasks.
// In 2.5 we used (macro) tasks (in combination with microtasks).
// However, it has subtle problems when state is changed right before repaint
// (e.g. #6813, out-in transitions).
// Also, using (macro) tasks in event handler would cause some weird behaviors
// that cannot be circumvented (e.g. #7109, #7153, #7546, #7834, #8109).
// So we now use microtasks everywhere, again.
// A major drawback of this tradeoff is that there are some scenarios
// where microtasks have too high a priority and fire in between supposedly
// sequential events (e.g. #4521, #6690, which have workarounds)
// or even between bubbling of the same event (#6566).
// 初始化异步执行方法
let timerFunc

// The nextTick behavior leverages the microtask queue, which can be accessed
// via either native Promise.then or MutationObserver.
// MutationObserver has wider support, however it is seriously bugged in
// UIWebView in iOS >= 9.3.3 when triggered in touch event handlers. It
// completely stops working after triggering a few times... so, if native
// Promise is available, we will use it:
/* istanbul ignore next, $flow-disable-line */
// 处理浏览器异步方案的兼容问题
// 如果支持原生Promise，则使用原生Promise
if (typeof Promise !== 'undefined' && isNative(Promise)) {
  const p = Promise.resolve()
	// 使用Promise.resolve将flushCallback执行过程推入微任务队列
  timerFunc = () => {
    p.then(flushCallbacks)
    // In problematic UIWebViews, Promise.then doesn't completely break, but
    // it can get stuck in a weird state where callbacks are pushed into the
    // microtask queue but the queue isn't being flushed, until the browser
    // needs to do some other work, e.g. handle a timer. Therefore we can
    // "force" the microtask queue to be flushed by adding an empty timer.
		// 解决IOS中的bug，微任务队列中任务不被执行的问题：通过添加空的定时器强制刷新微任务队列
    if (isIOS) setTimeout(noop)
  }
	// 将使用微任务标识置为true
  isUsingMicroTask = true
}
// 如果不支持原生Promise且不是IE浏览器，且支持原生MutationObserver，则使用原生MutationObserver
// 兼容平台：PhantomJS，IOS，Andriod 4.4
else if (!isIE && typeof MutationObserver !== 'undefined' && (
  isNative(MutationObserver) ||
  // PhantomJS and iOS 7.x
  MutationObserver.toString() === '[object MutationObserverConstructor]'
)) {
  // Use MutationObserver where native Promise is not available,
  // e.g. PhantomJS, iOS7, Android 4.4
  // (#6466 MutationObserver is unreliable in IE11)
	// 创建MutationObserver实例，将flushCallbacks作为回调函数
  let counter = 1
  const observer = new MutationObserver(flushCallbacks)
	// 创建文本节点作为MutationObserver的观察对象
  const textNode = document.createTextNode(String(counter))
  observer.observe(textNode, {
    characterData: true
  })
	// 在异步任务执行方法中手动改变被观察节点的内容，引起MutationObserver的反应，将flushCallbacks推入微任务执行队列
  timerFunc = () => {
    counter = (counter + 1) % 2
    textNode.data = String(counter)
  }
	// 将使用微任务标识置为true
  isUsingMicroTask = true
}
// 如果不支持微任务Promise / MutationObserver，则使用宏任务。
// 如果支持setImmediate，则使用setImmediate：IE实现支持
else if (typeof setImmediate !== 'undefined' && isNative(setImmediate)) {
  // Fallback to setImmediate.
  // Technically it leverages the (macro) task queue,
  // but it is still a better choice than setTimeout.
	// 在异步任务执行方法中调用setImmediate将flushCallbacks推入宏任务执行队列
  timerFunc = () => {
    setImmediate(flushCallbacks)
  }
}
// 如果不支持微任务也不支持`setImmediate`，则使用`setTimeout`
else {
  // Fallback to setTimeout.
	// 在异步任务执行方法中调用setTimeout将flushCallbacks推入宏任务执行队列
  timerFunc = () => {
    setTimeout(flushCallbacks, 0)
  }
}

// 异步队列执行函数
export function nextTick (cb?: Function, ctx?: Object) {
	// 初始化解决方法_resolve
  let _resolve
	// 为cb添加异常处理，存入callbacks数组
  callbacks.push(() => {
		// 如果cb不为空，则调用cb
    if (cb) {
      try {
        cb.call(ctx)
      } catch (e) {
				// 捕捉cb的执行错误，进行处理
        handleError(e, ctx, 'nextTick')
      }
    }
		// 如果cb为空，解决方法_resolve不为空，则将ctx参数执行_resolve
		else if (_resolve) {
      _resolve(ctx)
    }
  })
	// 如果当前执行队列没有在刷新，则立即开始执行队列中的任务
  if (!pending) {
		// 将等待标识置为true
    pending = true
		// 执行队列中的任务
    timerFunc()
  }
  // $flow-disable-line
	// 如果cb为空，则返回promise代理队列中任务执行的终值
  if (!cb && typeof Promise !== 'undefined') {
    return new Promise(resolve => {
			// 将promise的解决函数赋值给_resolve，则只有在当前任务执行结束后promise才完成
      _resolve = resolve
    })
  }
}
