/* @flow */

import {
  warn,
  nextTick,
  emptyObject,
  handleError,
  defineReactive
} from '../util/index'

import { createElement } from '../vdom/create-element'
import { installRenderHelpers } from './render-helpers/index'
import { resolveSlots } from './render-helpers/resolve-slots'
import { normalizeScopedSlots } from '../vdom/helpers/normalize-scoped-slots'
import VNode, { createEmptyVNode } from '../vdom/vnode'

import { isUpdatingChildComponent } from './lifecycle'

export function initRender (vm: Component) {
	// vm的虚拟dom根节点
  vm._vnode = null // the root of the child tree
	// vm的虚拟dom缓存根节点，为v-once设置的
  vm._staticTrees = null // v-once cached trees
	// 获取当前vm的选项参数
  const options = vm.$options
	// 获取父虚拟dom节点，作为占位符赋值给vm.$vnode
  const parentVnode = vm.$vnode = options._parentVnode // the placeholder node in parent tree
	// 获取父节点的渲染上下文，即父组件vm
  const renderContext = parentVnode && parentVnode.context
	// 创建vm.$slots
  vm.$slots = resolveSlots(options._renderChildren, renderContext)
	// 初始化vm.$scopedSlots为空对象
  vm.$scopedSlots = emptyObject
  // bind the createElement fn to this instance
  // so that we get proper render context inside it.
  // args order: tag, data, children, normalizationType, alwaysNormalize
  // internal version is used by render functions compiled from templates
	// 创建对模板编译`render`进行渲染的函数
  vm._c = (a, b, c, d) => createElement(vm, a, b, c, d, false)
  // normalization is always applied for the public version, used in
  // user-written render functions.
	// 创建对用户自定义`render`进行渲染的函数
  vm.$createElement = (a, b, c, d) => createElement(vm, a, b, c, d, true)

  // $attrs & $listeners are exposed for easier HOC creation.
  // they need to be reactive so that HOCs using them are always updated
	// 获取父节点中的data选项
  const parentData = parentVnode && parentVnode.data

  /* istanbul ignore else */
	// 将标签属性和事件监听器定义为vm的响应式属性
	// 在开发环境中，如果当前子组件正在更新，则提示警告信息
  if (process.env.NODE_ENV !== 'production') {
    defineReactive(vm, '$attrs', parentData && parentData.attrs || emptyObject, () => {
      !isUpdatingChildComponent && warn(`$attrs is readonly.`, vm)
    }, true)
    defineReactive(vm, '$listeners', options._parentListeners || emptyObject, () => {
      !isUpdatingChildComponent && warn(`$listeners is readonly.`, vm)
    }, true)
  } else {
    defineReactive(vm, '$attrs', parentData && parentData.attrs || emptyObject, null, true)
    defineReactive(vm, '$listeners', options._parentListeners || emptyObject, null, true)
  }
}
// 当前正在渲染的Vue实例
export let currentRenderingInstance: Component | null = null

// for testing only
// 设置当前渲染Vue实例的方法
export function setCurrentRenderingInstance (vm: Component) {
  currentRenderingInstance = vm
}

// 为Vue原型添加`$nextTick`和`_render`方法
export function renderMixin (Vue: Class<Component>) {
  // install runtime convenience helpers
	// 为Vue原型添加工具方法
  installRenderHelpers(Vue.prototype)

	// 为Vue原型添加$nextTick方法
  Vue.prototype.$nextTick = function (fn: Function) {
    return nextTick(fn, this)
  }

	// 为Vue原型添加_render方法
	// 创建虚拟dom节点的方法
  Vue.prototype._render = function (): VNode {
		// 获取当前Vue实例，即vm
    const vm: Component = this
		// 获取render函数和父虚拟dom节点_parentVnode
    const { render, _parentVnode } = vm.$options

		// 如果存在父节点，则将vm.$slots转化为函数，挂载到vm.$scopedSlots
    if (_parentVnode) {
      vm.$scopedSlots = normalizeScopedSlots(
        _parentVnode.data.scopedSlots,
        vm.$slots,
        vm.$scopedSlots
      )
    }

    // set parent vnode. this allows render functions to have access
    // to the data on the placeholder node.
		// 将父虚拟dom节点作为vm.$vnode的占位符
    vm.$vnode = _parentVnode
    // render self
    let vnode
    try {
      // There's no need to maintain a stack because all render fns are called
      // separately from one another. Nested component's render fns are called
      // when parent component is patched.
			// 将当前Vue实例标记为正在渲染Vue实例
      currentRenderingInstance = vm
			// 调用用户传递的`render`函数或者编译模板后转化的`render`函数，得到vnode即当前Vue实例的虚拟dom
      vnode = render.call(vm._renderProxy, vm.$createElement)
    }
		// 捕获render方法的调用错误
		catch (e) {
			// 处理`render`的错误
      handleError(e, vm, `render`)
      // return error render result,
      // or previous vnode to prevent render error causing blank component
      /* istanbul ignore else */
			// 开发环境中，如果传递了捕获render错误的回调函数，则执行该回调函数
      if (process.env.NODE_ENV !== 'production' && vm.$options.renderError) {
        try {
					// 执行render错误捕获回调函数
					// 将vnode赋值为错误回调的执行结果
          vnode = vm.$options.renderError.call(vm._renderProxy, vm.$createElement, e)
        } catch (e) {
					// 捕获回调函数执行的错误
          handleError(e, vm, `renderError`)
					// 将当前vnode赋值为旧的vnode
          vnode = vm._vnode
        }
      }
			// 在生产环境中直接将旧的vnode赋值给新vnode
			else {
        vnode = vm._vnode
      }
    }
		// 将当前正在渲染Vue实例重置为空
		finally {
      currentRenderingInstance = null
    }
    // if the returned array contains only a single node, allow it
		// 如果当前vnode为长度为1的数组，则去掉数组的嵌套
    if (Array.isArray(vnode) && vnode.length === 1) {
      vnode = vnode[0]
    }
    // return empty vnode in case the render function errored out
		// 如果创建出的虚拟dom节点不是VNode实例，则将当前vnode赋值为空节点
    if (!(vnode instanceof VNode)) {
			// 如果新vnode是数组，则在开发环境中提示警告信息
      if (process.env.NODE_ENV !== 'production' && Array.isArray(vnode)) {
        warn(
          'Multiple root nodes returned from render function. Render function ' +
          'should return a single root node.',
          vm
        )
      }
			// 将当前vnode赋值为空节点
      vnode = createEmptyVNode()
    }
    // set parent
		// 将父组件的vnode挂载到当前vnode的parent属性上
    vnode.parent = _parentVnode
		// 返回新vnode
    return vnode
  }
}
