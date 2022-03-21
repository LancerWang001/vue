/* @flow */

import VNode from './vnode'
import { resolveConstructorOptions } from 'core/instance/init'
import { queueActivatedComponent } from 'core/observer/scheduler'
import { createFunctionalComponent } from './create-functional-component'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isObject
} from '../util/index'

import {
  resolveAsyncComponent,
  createAsyncPlaceholder,
  extractPropsFromVNodeData
} from './helpers/index'

import {
  callHook,
  activeInstance,
  updateChildComponent,
  activateChildComponent,
  deactivateChildComponent
} from '../instance/lifecycle'

import {
  isRecyclableComponent,
  renderRecyclableComponentTemplate
} from 'weex/runtime/recycle-list/render-component-template'

// inline hooks to be invoked on component VNodes during patch
/**
 * @const {Record<string, Function>} componentVNodeHooks
 * @description 组件的内置钩子函数集合
 */
const componentVNodeHooks = {
  /**
   * @name init
   * @description 组件初始化时调用的钩子函数
   * @param {VNodeWithData} vnode 组件节点 VNode
   * @param {boolean} hydrating 是否是服务端渲染
   */
  init(vnode: VNodeWithData, hydrating: boolean): ?boolean {
    // 如果组件实例已经创建、没有被销毁且是 keep-alive 组件，则将本次钩子函数调用当作 prepatch 钩子的调用
    if (
      vnode.componentInstance &&
      !vnode.componentInstance._isDestroyed &&
      vnode.data.keepAlive
    ) {
      // kept-alive components, treat as a patch
      const mountedNode: any = vnode // work around flow
      componentVNodeHooks.prepatch(mountedNode, mountedNode)
    }
    // 否则根据组件 VNode 创建组件实例，并渲染成真实dom
    else {
      // 创建组件实例
      const child = vnode.componentInstance = createComponentInstanceForVnode(
        vnode,
        activeInstance // 当前组件的父组件对象
      )
      // 将组件实例渲染成真实dom
      child.$mount(hydrating ? vnode.elm : undefined, hydrating)
    }
  },

  prepatch(oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
    const options = vnode.componentOptions
    const child = vnode.componentInstance = oldVnode.componentInstance
    updateChildComponent(
      child,
      options.propsData, // updated props
      options.listeners, // updated listeners
      vnode, // new parent vnode
      options.children // new children
    )
  },

  insert(vnode: MountedComponentVNode) {
    const { context, componentInstance } = vnode
    if (!componentInstance._isMounted) {
      componentInstance._isMounted = true
      callHook(componentInstance, 'mounted')
    }
    if (vnode.data.keepAlive) {
      if (context._isMounted) {
        // vue-router#1212
        // During updates, a kept-alive component's child components may
        // change, so directly walking the tree here may call activated hooks
        // on incorrect children. Instead we push them into a queue which will
        // be processed after the whole patch process ended.
        queueActivatedComponent(componentInstance)
      } else {
        activateChildComponent(componentInstance, true /* direct */)
      }
    }
  },

  destroy(vnode: MountedComponentVNode) {
    const { componentInstance } = vnode
    if (!componentInstance._isDestroyed) {
      if (!vnode.data.keepAlive) {
        componentInstance.$destroy()
      } else {
        deactivateChildComponent(componentInstance, true /* direct */)
      }
    }
  }
}

const hooksToMerge = Object.keys(componentVNodeHooks)

/**
 * @name createComponent
 * @description 创建组件节点 VNode
 * @param {Class<Component> | Function | Object | void} Ctor 组件构造函数
 * @param {VNodeData} data 组件参数选项对象
 * @param {Component} context 组件对象
 * @param {VNode[]} children 组件子节点
 * @param {string} tag 组件名
 * @returns {VNode | Array<VNode> | void} 组件节点的 VNode
 */
export function createComponent(
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  // 如果组件构造函数不存在，则直接返回
  if (isUndef(Ctor)) {
    return
  }

  /**
   * @const {Function} baseCtor 组件构造函数
   */
  // 获取组件对象的构造函数
  const baseCtor = context.$options._base

  // plain options object: turn it into a constructor
  // 如果参数中的构造函数是对象格式，则将构造函数作为继承参数获取组件构造函数
  if (isObject(Ctor)) {
    Ctor = baseCtor.extend(Ctor)
  }

  // if at this stage it's not a constructor or an async component factory,
  // reject.
  // 如果构造函数不是函数，则在开发环境提示警告信息后，直接返回
  if (typeof Ctor !== 'function') {
    if (process.env.NODE_ENV !== 'production') {
      warn(`Invalid Component definition: ${String(Ctor)}`, context)
    }
    return
  }

  // async component
  // 如果构造函数的 cid 为空，则说明组件构造函数是异步函数 async function，根据该异步函数创建真正的组件构造函数
  let asyncFactory
  if (isUndef(Ctor.cid)) {
    asyncFactory = Ctor
    // 根据异步函数创建真正的组件构造函数
    Ctor = resolveAsyncComponent(asyncFactory, baseCtor)
    // 如果创建的组件构造函数为空，则返回空的占位节点，但仍保留组件中的数据
    if (Ctor === undefined) {
      // return a placeholder node for async component, which is rendered
      // as a comment node but preserves all the raw information for the node.
      // the information will be used for async server-rendering and hydration.
      return createAsyncPlaceholder(
        asyncFactory,
        data,
        context,
        children,
        tag
      )
    }
  }

  data = data || {}

  // resolve constructor options in case global mixins are applied after
  // component constructor creation
  // 处理组件构造函数的参数，将组件的继承选项和父类选项合并赋值给子类选项，保证组件创建完成后可以应用全局混入
  resolveConstructorOptions(Ctor)

  // transform component v-model data into props & events
  // 如果组件使用了 v-model，则为组件添加相应的属性和事件处理函数
  if (isDef(data.model)) {
    transformModel(Ctor.options, data)
  }

  // extract props
  // 提取组件中所有的 props 属性
  const propsData = extractPropsFromVNodeData(data, Ctor, tag)

  // functional component
  // 如果组件是函数式组件，则根据组件属性生成函数组件节点并返回
  if (isTrue(Ctor.options.functional)) {
    return createFunctionalComponent(Ctor, propsData, data, context, children)
  }

  // extract listeners, since these needs to be treated as
  // child component listeners instead of DOM listeners
  // 从组件中提取所有的事件监听器
  const listeners = data.on
  // replace with listeners with .native modifier
  // so it gets processed during parent component patch.
  // 将组件中原本的事件监听器替换为原生事件监听器，方便在父组件更新期间进行处理
  data.on = data.nativeOn

  // 如果组件是抽象组件，则清空参数选项对象，只保留 slot
  if (isTrue(Ctor.options.abstract)) {
    // abstract components do not keep anything
    // other than props & listeners & slot

    // work around flow
    const slot = data.slot
    data = {}
    if (slot) {
      data.slot = slot
    }
  }

  // install component management hooks onto the placeholder node
  // 为组件添加组件内部使用的 hooks 钩子函数
  installComponentHooks(data)

  // return a placeholder vnode
  const name = Ctor.options.name || tag
  // 生成组件节点 VNode
  const vnode = new VNode(
    `vue-component-${Ctor.cid}${name ? `-${name}` : ''}`,
    data, undefined, undefined, undefined, context,
    { Ctor, propsData, listeners, tag, children },
    asyncFactory
  )

  // Weex specific: invoke recycle-list optimized @render function for
  // extracting cell-slot template.
  // https://github.com/Hanks10100/weex-native-directive/tree/master/component
  /* istanbul ignore if */
  if (__WEEX__ && isRecyclableComponent(vnode)) {
    return renderRecyclableComponentTemplate(vnode)
  }
  // 返回 VNode
  return vnode
}

/**
 * @name createComponentInstanceForVnode
 * @description 根据组件 VNode 创建组件实例的方法
 * @param {any} vnode 当前组件 Vnode
 * @param {any} parent 父节点实例
 * @returns {Component} 组件实例
 */
export function createComponentInstanceForVnode(
  // we know it's MountedComponentVNode but flow doesn't
  vnode: any,
  // activeInstance in lifecycle state
  parent: any
): Component {
  /**
   * @const {InternalComponentOptions} options
   * @description 初始化组件创建的参数选项
   * @property {boolean} _isComponent 是否是组件实例
   * @property {any} _parentVnode 父节点 VNode
   * @property {any} parent 父节点实例
   */
  const options: InternalComponentOptions = {
    _isComponent: true,
    _parentVnode: vnode,
    parent
  }
  // check inline-template render functions
  // 检查组件是否有内联模板
  const inlineTemplate = vnode.data.inlineTemplate
  // 如果有内联模板，则用内联模板的 render、staticRenderFns 覆盖当前组件的 render、staticRenderFns
  if (isDef(inlineTemplate)) {
    options.render = inlineTemplate.render
    options.staticRenderFns = inlineTemplate.staticRenderFns
  }
  // 根据参数选项创建组件实例并返回
  return new vnode.componentOptions.Ctor(options)
}

/**
 * @name installComponentHooks
 * @description 为组件节点添加内置钩子函数
 * @param {VNodeData} data 组件参数选项对象
 */
function installComponentHooks(data: VNodeData) {
  /**
   * @const {Record<string, Function>} hooks
   * @description 初始化用户传入的组件钩子函数集合
   */
  const hooks = data.hook || (data.hook = {})
  // 循环内置钩子函数，合并用户钩子函数与内置钩子函数
  for (let i = 0; i < hooksToMerge.length; i++) {
    // 获取内置钩子函数的名称
    const key = hooksToMerge[i]
    // 根据内置钩子函数名，获取用户传入的钩子函数
    const existing = hooks[key]
    // 根据内置钩子函数名，获取内置的钩子函数
    const toMerge = componentVNodeHooks[key]
    // 当内置钩子函数与用户钩子函数不同，且没有合并过，则将用户钩子函数与内置钩子函数进行合并
    if (existing !== toMerge && !(existing && existing._merged)) {
      // 用户钩子函数不为空的情况下，合并用户钩子函数和内置钩子函数，否则为组件添加内置钩子函数
      hooks[key] = existing ? mergeHook(toMerge, existing) : toMerge
    }
  }
}

function mergeHook(f1: any, f2: any): Function {
  const merged = (a, b) => {
    // flow complains about extra args which is why we use any
    f1(a, b)
    f2(a, b)
  }
  merged._merged = true
  return merged
}

// transform component v-model info (value and callback) into
// prop and event handler respectively.
function transformModel(options, data: any) {
  const prop = (options.model && options.model.prop) || 'value'
  const event = (options.model && options.model.event) || 'input'
    ; (data.attrs || (data.attrs = {}))[prop] = data.model.value
  const on = data.on || (data.on = {})
  const existing = on[event]
  const callback = data.model.callback
  if (isDef(existing)) {
    if (
      Array.isArray(existing)
        ? existing.indexOf(callback) === -1
        : existing !== callback
    ) {
      on[event] = [callback].concat(existing)
    }
  } else {
    on[event] = callback
  }
}
