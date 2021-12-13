/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import Dep, { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute,
  invokeWithErrorHandling
} from '../util/index'

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

export function initState (vm: Component) {
  vm._watchers = []
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props)
  if (opts.methods) initMethods(vm, opts.methods)
  if (opts.data) {
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  if (opts.computed) initComputed(vm, opts.computed)
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
}

function initProps (vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {}
  const props = vm._props = {}
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys = vm.$options._propKeys = []
  const isRoot = !vm.$parent
  // root instance props should be converted
  if (!isRoot) {
    toggleObserving(false)
  }
  for (const key in propsOptions) {
    keys.push(key)
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
          config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
      defineReactive(props, key, value)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}

function initData (vm: Component) {
  let data = vm.$options.data
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) {
      proxy(vm, `_data`, key)
    }
  }
  // observe data
  observe(data, true /* asRootData */)
}

export function getData (data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

const computedWatcherOptions = { lazy: true }

function initComputed (vm: Component, computed: Object) {
  // $flow-disable-line
	// 初始化vm._computedWatchers为空对象
  const watchers = vm._computedWatchers = Object.create(null)
  // computed properties are just getters during SSR
	// 获取当前是否是SSR的标识
  const isSSR = isServerRendering()

	// 遍历vm.options.computed对象
  for (const key in computed) {
		// 根据computed的key获取计算属性的属性描述
    const userDef = computed[key]
		// 根据属性描述获取计算属性的getter
    const getter = typeof userDef === 'function' ? userDef : userDef.get
		// 如果getter为空，且当前环境为开发环境，则提示响应的警示信息
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      warn(
        `Getter is missing for computed property "${key}".`,
        vm
      )
    }

		// 如果当前环境不是SSR，则创建lazy watcher，存入vm._computedWatchers中
    if (!isSSR) {
      // create internal watcher for the computed property.
      watchers[key] = new Watcher(
        vm,
				// 默认getter为空函数
        getter || noop,
				// 更新订阅回调函数为空函数
        noop,
				// watcher默认是延迟执行的
        computedWatcherOptions
      )
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.
		// 如果当前vm没有当前计算属性同名的属性，则创建该计算属性
    if (!(key in vm)) {
      defineComputed(vm, key, userDef)
    }
		// 否则在开发环境中提示相应的警示
		else if (process.env.NODE_ENV !== 'production') {
			// 如果当前属性同data/props/methods中的属性同名，则提示警示信息
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      } else if (vm.$options.methods && key in vm.$options.methods) {
        warn(`The computed property "${key}" is already defined as a method.`, vm)
      }
    }
  }
}

export function defineComputed (
  target: any,
  key: string,
  userDef: Object | Function
) {
	// 如果当前环境不是服务端渲染，则设置缓存标识为true
  const shouldCache = !isServerRendering()
	// 获取计算属性的属性描述，默认的描述是可配置、可枚举，getter/setter为空函数
	// 合并用户传入的属性描述和默认属性描述中的`getter/setter`
	// 如果用户传入的属性描述是函数，则将用户属性描述作为用户传入的属性`getter`
  if (typeof userDef === 'function') {
		// 如果缓存标识为true，则通过`createComputedGetter`创建计算属性的`getter`，在watcher依赖不变的情况下，不会重新计算属性的值
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
			// 否则通过`createGetterInvoker`创建计算属性的`getter`，每次取值时都会重新计算属性值
      : createGetterInvoker(userDef)
		// 将属性的`setter`置为空函数
    sharedPropertyDefinition.set = noop
  } else {
		// 否则，认为用户传入的属性描述为对象，并从用户属性描述的`get`/`set`中获取用户传入的`getter`/`setter`
    sharedPropertyDefinition.get = userDef.get
			// 如果缓存标识为true，且用户传入的属性描述中没有设置cache为false，通过`createComputedGetter`创建属性的`getter`，在watcher依赖不变的情况下，不会重新计算属性的值
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
				// 否则通过`createGetterInvoker`创建计算属性的`getter`，每次取值时都会重新计算属性值
        : createGetterInvoker(userDef.get)
      : noop
		// 将用户传入的`setter`作为计算属性的setter
    sharedPropertyDefinition.set = userDef.set || noop
  }
	// 在开发环境中，如果计算属性的`setter`为空函数，则提示响应的警示信息
  if (process.env.NODE_ENV !== 'production' &&
      sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
	// 为vm添加计算属性
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

function createComputedGetter (key) {
  return function computedGetter () {
		// 获取Vue实例上的计算属性监听器watcher
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
			// 如果watcher存在，则判断watcher的依赖是否发生了变化
			// 如果watcher依赖改变，则重新计算watcher的订阅值
      if (watcher.dirty) {
        watcher.evaluate()
      }
			// 如果当前存在依赖目标量，则更新依赖
      if (Dep.target) {
        watcher.depend()
      }
			// 返回当前监听器的订阅值
      return watcher.value
    }
  }
}

function createGetterInvoker(fn) {
  return function computedGetter () {
		// 用vm执行当前计算属性的`getter`，并将计算结果返回
    return fn.call(this, this)
  }
}

function initMethods (vm: Component, methods: Object) {
  const props = vm.$options.props
  for (const key in methods) {
    if (process.env.NODE_ENV !== 'production') {
      if (typeof methods[key] !== 'function') {
        warn(
          `Method "${key}" has type "${typeof methods[key]}" in the component definition. ` +
          `Did you reference the function correctly?`,
          vm
        )
      }
      if (props && hasOwn(props, key)) {
        warn(
          `Method "${key}" has already been defined as a prop.`,
          vm
        )
      }
      if ((key in vm) && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
          `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    vm[key] = typeof methods[key] !== 'function' ? noop : bind(methods[key], vm)
  }
}

function initWatch (vm: Component, watch: Object) {
	// 遍历vm.options.watch对象
  for (const key in watch) {
		// 根据key获取当前处理器对象handler
    const handler = watch[key]
		// 如果处理器是数组，则遍历数组，为数组中的每个子处理器创建当前key的watcher侦听器
    if (Array.isArray(handler)) {
			// 遍历数组，为每个数组中的每个子处理器创建当前key的watcher侦听器
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
			// 否则为处理器创建当前key的watcher侦听器
      createWatcher(vm, key, handler)
    }
  }
}

function createWatcher (
  vm: Component,
  expOrFn: string | Function,
  handler: any,
  options?: Object
) {
	// 如果处理器handler是对象，将handler作为watcher的选项，handler中的handler属性作为处理器对象
  if (isPlainObject(handler)) {
		// 将handler作为watcher的选项options
    options = handler
		// 将handler的handler属性作为处理器对象
    handler = handler.handler
  }
	// 如果handler处理器对象是字符串，将`vm`中对应的属性值作为handler处理器对象
  if (typeof handler === 'string') {
		// 将`vm`中对应的属性值作为handler处理器对象
    handler = vm[handler]
  }
	// 创建watcher对象并返回
  return vm.$watch(expOrFn, handler, options)
}

export function stateMixin (Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {}
  dataDef.get = function () { return this._data }
  const propsDef = {}
  propsDef.get = function () { return this._props }
  if (process.env.NODE_ENV !== 'production') {
    dataDef.set = function () {
      warn(
        'Avoid replacing instance root $data. ' +
        'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef)
  Object.defineProperty(Vue.prototype, '$props', propsDef)

  Vue.prototype.$set = set
  Vue.prototype.$delete = del

  Vue.prototype.$watch = function (
    expOrFn: string | Function,
    cb: any,
    options?: Object
  ): Function {
		// 获取Vue实例，即this
    const vm: Component = this
		// 如果cb回调函数是对象，则将cb作为handler再次调用createWatcher，且将watcher返回
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options)
    }
		// 为options选项添加默认值，即空对象
    options = options || {}
		// 为选项添加选项user = true，标识当前watcher为用户自定义watcher
    options.user = true
		// 创建Watcher实例
    const watcher = new Watcher(vm, expOrFn, cb, options)
		// 如果需要立即执行，则立即执行一次回调函数
    if (options.immediate) {
			// 生成提示信息，在回调函数执行报错时弹出
      const info = `callback for immediate watcher "${watcher.expression}"`
			// 将当前依赖目标置空
      pushTarget()
			// 调用回调处理函数
      invokeWithErrorHandling(cb, vm, [watcher.value], vm, info)
			// 恢复上一帧的依赖目标
      popTarget()
    }
		// 返回取消订阅的方法
    return function unwatchFn () {
      watcher.teardown()
    }
  }
}
