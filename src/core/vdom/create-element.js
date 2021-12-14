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
	// 如果元素设置了v-bind:is，则将tag设置为data.is
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
	// 初始化虚拟dom节点vnode，命名空间ns
  let vnode, ns
	// 如果tag是字符串类型，则根据标签生成对应的vnode
  if (typeof tag === 'string') {
		// 初始化组件构造函数
    let Ctor
		// 获取命名空间
    ns = (context.$vnode && context.$vnode.ns) || config.getTagNamespace(tag)
		// 判断tag是否是保留字段
		// 如果是保留字段，说明是html标签
    if (config.isReservedTag(tag)) {
      // platform built-in elements
			// 开发环境中，如果在v-on指令中使用了'.native'修饰符，则提示警告信息
      if (process.env.NODE_ENV !== 'production' && isDef(data) && isDef(data.nativeOn) && data.tag !== 'component') {
        warn(
          `The .native modifier for v-on is only valid on components but it was used on <${tag}>.`,
          context
        )
      }
			// 根据标签创建虚拟dom节点
      vnode = new VNode(
				// 根据运行平台，解析出平台支持的标签名
        config.parsePlatformTagName(tag), data, children,
        undefined, undefined, context
      )
    }
		// 如果是自定义组件且没有使用v-pre指令，则根据组件名创建相应的组件虚拟节点
		else if (
			// 没有使用v-pre指令
			(!data || !data.pre) &&
			// 是自定义组件：resolveAsset查找自定义组件的构造函数声明
			isDef(Ctor = resolveAsset(context.$options, 'components', tag))
		) {
      // component
			// 根据自定义组件构造函数创建虚拟dom节点
      vnode = createComponent(Ctor, data, context, children, tag)
    } else {
      // unknown or unlisted namespaced elements
      // check at runtime because it may get assigned a namespace when its
      // parent normalizes children
			// 否则创建自定义标签的vnode
      vnode = new VNode(
        tag, data, children,
        undefined, undefined, context
      )
    }
  } else {
    // direct component options / constructor
		// 如果tag不是字符串，则会被认为是组件
		// 根据tag创建对应的组件虚拟dom节点
    vnode = createComponent(tag, data, context, children)
  }
	// 如果虚拟dom节点是数组，则直接返回vnode
  if (Array.isArray(vnode)) {
    return vnode
  }
	// 如果虚拟dom节点不为数组且不为空，则认为虚拟dom节点是对象类型
	// 对虚拟dom做一些处理，然后直接返回虚拟dom节点
	else if (isDef(vnode)) {
		// 如果当前节点的根节点中有命名空间，即认为是svg标签或math标签，则为当前虚拟dom节点也添加该命名空间
    if (isDef(ns)) applyNS(vnode, ns)
		// 将该节点的style/class响应式依赖添加到当前渲染对象的依赖目标中
    if (isDef(data)) registerDeepBindings(data)
		// 返回虚拟dom节点
    return vnode
  }
	// 否则返回空虚拟dom节点
	else {
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
