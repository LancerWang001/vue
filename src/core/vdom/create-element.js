/* @flow */

import config from '../config'
import VNode, { createEmptyVNode } from './vnode'
import { createComponent } from './create-component'
import { traverse } from '../observer/traverse'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isObject,
  isPrimitive,
  resolveAsset
} from '../util/index'

import {
  normalizeChildren,
  simpleNormalizeChildren
} from './helpers/index'

const SIMPLE_NORMALIZE = 1
const ALWAYS_NORMALIZE = 2

// wrapper function for providing a more flexible interface
// without getting yelled at by flow
export function createElement (
	// createElement函数的执行上下文，一般指Vue的实例vm
  context: Component,
	// 标签名或Vue组件
  tag: any,
	// tag描述，VNode的参数
  data: any,
	// 子节点或文本节点
  children: any,
	// 对子节点的处理类型
  normalizationType: any,
	// 是否始终对子节点进行标准化处理
  alwaysNormalize: boolean
): VNode | Array<VNode> {
	// 对参数进行重载处理
	// 当前data为数组或原始类型时，认为参数中没有传递data即VNode参数
  if (Array.isArray(data) || isPrimitive(data)) {
		// 形参列表位置移动，data之后的参数向前移动，将data置为空
    normalizationType = children
    children = data
    data = undefined
  }
	// 如果始终对子节点进行标准化处理，则将normalizationType赋值为2
	// vm.$createElement中，alwaysNormalize参数为true，即渲染用户render时，始终对子节点进行标准化处理
	// vm._c中，alwaysNormalize为false，即渲染模板编译的`render`函数时，对子节点的处理是通过配置完成的
  if (isTrue(alwaysNormalize)) {
    normalizationType = ALWAYS_NORMALIZE
  }
	// 返回_createElement执行的结果，创建VNode
  return _createElement(context, tag, data, children, normalizationType)
}

// 创建VNode虚拟dom
export function _createElement (
	// createElement函数的执行上下文，一般指Vue的实例vm
  context: Component,
	// 标签名或Vue组件
  tag?: string | Class<Component> | Function | Object,
	// tag描述，VNode的参数
  data?: VNodeData,
	// 子节点或文本节点
  children?: any,
	// 对子节点的处理类型
  normalizationType?: number
): VNode | Array<VNode> {
	// 如果data选项是响应式数据，则在开发环境提示警告信息
  if (isDef(data) && isDef((data: any).__ob__)) {
		// 在开发环境提示警告信息
    process.env.NODE_ENV !== 'production' && warn(
      `Avoid using observed data object as vnode data: ${JSON.stringify(data)}\n` +
      'Always create fresh vnode data objects in each render!',
      context
    )
		// 返回空的注释节点
    return createEmptyVNode()
  }
  // object syntax in v-bind
	// <component v-bind:is="currentTabComponent" />
	// 如果data选项中有is属性，则将tag设置为data.is
  if (isDef(data) && isDef(data.is)) {
    tag = data.is
  }
	// 如果tag不存在，则返回空节点
  if (!tag) {
    // in case of component :is set to falsy value
    return createEmptyVNode()
  }
  // warn against non-primitive key
	// 在开发环境中，如果发现data.key不是原始值，则提示警告信息
  if (process.env.NODE_ENV !== 'production' &&
    isDef(data) && isDef(data.key) && !isPrimitive(data.key)
  ) {
    if (!__WEEX__ || !('@binding' in data.key)) {
      warn(
        'Avoid using non-primitive value as key, ' +
        'use string/number value instead.',
        context
      )
    }
  }
  // support single function children as default scoped slot
	// 处理作用域插槽
  if (Array.isArray(children) &&
    typeof children[0] === 'function'
  ) {
    data = data || {}
    data.scopedSlots = { default: children[0] }
    children.length = 0
  }
	// 如果normalizationType为2，则按照标准处理方式将所有子节点处理成一维数组
  if (normalizationType === ALWAYS_NORMALIZE) {
    children = normalizeChildren(children)
  }
	// 如果normalizationType为1，则将所有子节点简单处理成一维数组
	else if (normalizationType === SIMPLE_NORMALIZE) {
    children = simpleNormalizeChildren(children)
  }
  let vnode, ns
  if (typeof tag === 'string') {
    let Ctor
    ns = (context.$vnode && context.$vnode.ns) || config.getTagNamespace(tag)
    if (config.isReservedTag(tag)) {
      // platform built-in elements
      if (process.env.NODE_ENV !== 'production' && isDef(data) && isDef(data.nativeOn) && data.tag !== 'component') {
        warn(
          `The .native modifier for v-on is only valid on components but it was used on <${tag}>.`,
          context
        )
      }
      vnode = new VNode(
        config.parsePlatformTagName(tag), data, children,
        undefined, undefined, context
      )
    } else if ((!data || !data.pre) && isDef(Ctor = resolveAsset(context.$options, 'components', tag))) {
      // component
      vnode = createComponent(Ctor, data, context, children, tag)
    } else {
      // unknown or unlisted namespaced elements
      // check at runtime because it may get assigned a namespace when its
      // parent normalizes children
      vnode = new VNode(
        tag, data, children,
        undefined, undefined, context
      )
    }
  } else {
    // direct component options / constructor
    vnode = createComponent(tag, data, context, children)
  }
  if (Array.isArray(vnode)) {
    return vnode
  } else if (isDef(vnode)) {
    if (isDef(ns)) applyNS(vnode, ns)
    if (isDef(data)) registerDeepBindings(data)
    return vnode
  } else {
    return createEmptyVNode()
  }
}

function applyNS (vnode, ns, force) {
  vnode.ns = ns
  if (vnode.tag === 'foreignObject') {
    // use default namespace inside foreignObject
    ns = undefined
    force = true
  }
  if (isDef(vnode.children)) {
    for (let i = 0, l = vnode.children.length; i < l; i++) {
      const child = vnode.children[i]
      if (isDef(child.tag) && (
        isUndef(child.ns) || (isTrue(force) && child.tag !== 'svg'))) {
        applyNS(child, ns, force)
      }
    }
  }
}

// ref #5318
// necessary to ensure parent re-render when deep bindings like :style and
// :class are used on slot nodes
function registerDeepBindings (data) {
  if (isObject(data.style)) {
    traverse(data.style)
  }
  if (isObject(data.class)) {
    traverse(data.class)
  }
}
