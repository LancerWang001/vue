/**
 * Virtual DOM patching algorithm based on Snabbdom by
 * Simon Friis Vindum (@paldepind)
 * Licensed under the MIT License
 * https://github.com/paldepind/snabbdom/blob/master/LICENSE
 *
 * modified by Evan You (@yyx990803)
 *
 * Not type-checking this because this file is perf-critical and the cost
 * of making flow understand it is not worth it.
 */

import VNode, { cloneVNode } from './vnode'
import config from '../config'
import { SSR_ATTR } from 'shared/constants'
import { registerRef } from './modules/ref'
import { traverse } from '../observer/traverse'
import { activeInstance } from '../instance/lifecycle'
import { isTextInputType } from 'web/util/element'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  makeMap,
  isRegExp,
  isPrimitive
} from '../util/index'

export const emptyNode = new VNode('', {}, [])

const hooks = ['create', 'activate', 'update', 'remove', 'destroy']

// 比较两个vnode是否相同
function sameVnode (a, b) {
  return (
		// vnode的key相同
    a.key === b.key &&
		// 异步组件的设置相同
    a.asyncFactory === b.asyncFactory && (
			// vnode类型相同
      (
				// 标签名相同
        a.tag === b.tag &&
				// 注释节点的类型相同
        a.isComment === b.isComment &&
				// data的类型相同
        isDef(a.data) === isDef(b.data) &&
				// input类型在同一范围内
        sameInputType(a, b)
      ) ||
			// 是未成功加载的异步组件节点
			(
				// 旧异步dom节点还没有加载
        isTrue(a.isAsyncPlaceholder) &&
				// 新异步dom节点加载失败
        isUndef(b.asyncFactory.error)
      )
    )
  )
}

function sameInputType (a, b) {
	// 如果不是input标签，直接返回
  if (a.tag !== 'input') return true
  let i
	// vnode.data.attrs.type
  const typeA = isDef(i = a.data) && isDef(i = i.attrs) && i.type
  const typeB = isDef(i = b.data) && isDef(i = i.attrs) && i.type
	// input type相同或type类型在指定范围之内：text,number,password,search,email,tel,url
  return typeA === typeB || isTextInputType(typeA) && isTextInputType(typeB)
}

function createKeyToOldIdx (children, beginIdx, endIdx) {
  let i, key
  const map = {}
  for (i = beginIdx; i <= endIdx; ++i) {
    key = children[i].key
    if (isDef(key)) map[key] = i
  }
  return map
}

// 创建patch函数的高阶函数
export function createPatchFunction (backend) {
  let i, j
	// 创建管理Vue钩子函数的容器
  const cbs = {}
 
	// 声明并初始化dom操作相关api
  const { modules, nodeOps } = backend

	// 挂载默认钩子函数
  for (i = 0; i < hooks.length; ++i) {
    cbs[hooks[i]] = []
    for (j = 0; j < modules.length; ++j) {
      if (isDef(modules[j][hooks[i]])) {
        cbs[hooks[i]].push(modules[j][hooks[i]])
      }
    }
  }

	// 创建空VNode
  function emptyNodeAt (elm) {
    return new VNode(nodeOps.tagName(elm).toLowerCase(), {}, [], undefined, elm)
  }

	// 创建节点删除方法
  function createRmCb (childElm, listeners) {
    function remove () {
      if (--remove.listeners === 0) {
        removeNode(childElm)
      }
    }
    remove.listeners = listeners
    return remove
  }

	// 删除节点方法
  function removeNode (el) {
    const parent = nodeOps.parentNode(el)
    // element may have already been removed due to v-html / v-text
    if (isDef(parent)) {
      nodeOps.removeChild(parent, el)
    }
  }

	// 判断是否是未知元素
  function isUnknownElement (vnode, inVPre) {
    return (
      !inVPre &&
      !vnode.ns &&
      !(
        config.ignoredElements.length &&
        config.ignoredElements.some(ignore => {
          return isRegExp(ignore)
            ? ignore.test(vnode.tag)
            : ignore === vnode.tag
        })
      ) &&
      config.isUnknownElement(vnode.tag)
    )
  }

	// 不进行编译的Vue节点数量
  let creatingElmInVPre = 0

	// 根据虚拟dom节点vnode创建真实dom节点的方法
  function createElm (
    vnode, // 虚拟dom节点
    insertedVnodeQueue, // 新增虚拟dom节点
    parentElm, // 父节点（真实dom）
    refElm, // 相邻真实节点
    nested, // 是否在递归中调用
    ownerArray, // 同级虚拟子节点数组
    index // 当前虚拟节点在子节点数组中的位置索引
  ) {
		// 如果vnode没有改变，并且不是根节点，则浅拷贝当前vnode保存起来
    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // This vnode was used in a previous render!
      // now it's used as a new node, overwriting its elm would cause
      // potential patch errors down the road when it's used as an insertion
      // reference node. Instead, we clone the node on-demand before creating
      // associated DOM element for it.
			// 1. 浅拷贝vnode
			// 2. 替换到子节点数组中对应的位置
			// 3. 赋值给当前节点
      vnode = ownerArray[index] = cloneVNode(vnode)
    }

		// 更新是否作为根节点插入的标记，方便在过渡动画中使用
    vnode.isRootInsert = !nested // for transition enter check
		// 尝试创建组件节点，并挂载到真实dom树，如果创建成功则直接返回
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
      return
    }

		// 获取vnode配置
    const data = vnode.data
		// 获取vnode子节点
    const children = vnode.children
		// 获取vnode标签名
    const tag = vnode.tag
		// 如果vnode存在，则根据vnode创建真实dom插入真实dom节点
    if (isDef(tag)) {
			// 在开发环境中，如果vnode标签是未知标签，则提示警告信息
      if (process.env.NODE_ENV !== 'production') {
				// 如果vnode是不进行编译的，则不编译节点数加一
        if (data && data.pre) {
          creatingElmInVPre++
        }
				// 如果是未知元素标签，则提示警告信息
        if (isUnknownElement(vnode, creatingElmInVPre)) {
          warn(
            'Unknown custom element: <' + tag + '> - did you ' +
            'register the component correctly? For recursive components, ' +
            'make sure to provide the "name" option.',
            vnode.context
          )
        }
      }

			// 根据vnode创建真实dom节点
      vnode.elm =
			// 如果vnode是svg或math标签，则创建对应的svg/math标签
			vnode.ns
        ? nodeOps.createElementNS(vnode.ns, tag)
				// 否则根据vnode标签创建真实dom节点
        : nodeOps.createElement(tag, vnode)
			// 设置样式作用域
      setScope(vnode)

      /* istanbul ignore if */
      if (__WEEX__) {
        // in Weex, the default insertion order is parent-first.
        // List items can be optimized to use children-first insertion
        // with append="tree".
        const appendAsTree = isDef(data) && isTrue(data.appendAsTree)
        if (!appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue)
          }
          insert(parentElm, vnode.elm, refElm)
        }
        createChildren(vnode, children, insertedVnodeQueue)
        if (appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue)
          }
          insert(parentElm, vnode.elm, refElm)
        }
      } else {
				// 创建子节点真实dom
        createChildren(vnode, children, insertedVnodeQueue)
				// 如果存在vnode.data，则触发`create`钩子函数
        if (isDef(data)) {
          invokeCreateHooks(vnode, insertedVnodeQueue)
        }
				// 将vnode映射成的真实dom节点插入真实dom树中
        insert(parentElm, vnode.elm, refElm)
      }
			// 在开发环境中，如果vnode是不进行编译的，则当前不编译节点统计数减小1
      if (process.env.NODE_ENV !== 'production' && data && data.pre) {
        creatingElmInVPre--
      }
    }
		// 如果vnode是注释节点，则创建对应的真实注释节点，并插入dom树中
		else if (isTrue(vnode.isComment)) {
			// 根据vnode.text创建真实注释节点，并赋值给vnode.elm
      vnode.elm = nodeOps.createComment(vnode.text)
			// 将新建的注释节点插入dom中
      insert(parentElm, vnode.elm, refElm)
    }
		// 否则认为vnode是文本节点，则创建对应的真实文本节点，并插入dom树中
		else {
			// 根据vnode.text创建真实文本节点，并赋值给vnode.elm
      vnode.elm = nodeOps.createTextNode(vnode.text)
			// 将新建的文本节点插入dom树中
      insert(parentElm, vnode.elm, refElm)
    }
  }

  function createComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i = vnode.data
    if (isDef(i)) {
      const isReactivated = isDef(vnode.componentInstance) && i.keepAlive
      if (isDef(i = i.hook) && isDef(i = i.init)) {
        i(vnode, false /* hydrating */)
      }
      // after calling the init hook, if the vnode is a child component
      // it should've created a child instance and mounted it. the child
      // component also has set the placeholder vnode's elm.
      // in that case we can just return the element and be done.
      if (isDef(vnode.componentInstance)) {
        initComponent(vnode, insertedVnodeQueue)
        insert(parentElm, vnode.elm, refElm)
        if (isTrue(isReactivated)) {
          reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
        }
        return true
      }
    }
  }

  function initComponent (vnode, insertedVnodeQueue) {
    if (isDef(vnode.data.pendingInsert)) {
      insertedVnodeQueue.push.apply(insertedVnodeQueue, vnode.data.pendingInsert)
      vnode.data.pendingInsert = null
    }
    vnode.elm = vnode.componentInstance.$el
    if (isPatchable(vnode)) {
      invokeCreateHooks(vnode, insertedVnodeQueue)
      setScope(vnode)
    } else {
      // empty component root.
      // skip all element-related modules except for ref (#3455)
      registerRef(vnode)
      // make sure to invoke the insert hook
      insertedVnodeQueue.push(vnode)
    }
  }

  function reactivateComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i
    // hack for #4339: a reactivated component with inner transition
    // does not trigger because the inner node's created hooks are not called
    // again. It's not ideal to involve module-specific logic in here but
    // there doesn't seem to be a better way to do it.
    let innerNode = vnode
    while (innerNode.componentInstance) {
      innerNode = innerNode.componentInstance._vnode
      if (isDef(i = innerNode.data) && isDef(i = i.transition)) {
        for (i = 0; i < cbs.activate.length; ++i) {
          cbs.activate[i](emptyNode, innerNode)
        }
        insertedVnodeQueue.push(innerNode)
        break
      }
    }
    // unlike a newly created component,
    // a reactivated keep-alive component doesn't insert itself
    insert(parentElm, vnode.elm, refElm)
  }

	// 插入子节点
  function insert (parent, elm, ref) {
		// 如果父节点不存在，则直接返回
    if (isDef(parent)) {
			// 如果相邻节点存在，则将真实dom节点插入相邻节点之前
      if (isDef(ref)) {
				// 如果相邻节点的父节点与当前节点的父节点不同，则直接返回
        if (nodeOps.parentNode(ref) === parent) {
          nodeOps.insertBefore(parent, elm, ref)
        }
      }
			// 否则将当前节点添加到父节点尾部
			else {
        nodeOps.appendChild(parent, elm)
      }
    }
  }

	// 创建子节点
  function createChildren (vnode, children, insertedVnodeQueue) {
		// 如果子节点是数组，则遍历子节点生成真实dom插入dom树中
    if (Array.isArray(children)) {
			// 如果当前环境是开发环境，则检查子节点中是否有重复节点
      if (process.env.NODE_ENV !== 'production') {
        checkDuplicateKeys(children)
      }
			// 遍历子节点数组，根据子节点创建真实dom节点
      for (let i = 0; i < children.length; ++i) {
        createElm(children[i], insertedVnodeQueue, vnode.elm, null, true, children, i)
      }
    }
		// 如果子节点不是数组类型（即认为子节点为空），且vnode.text是原始类型
		else if (isPrimitive(vnode.text)) {
			// 根据vnode.text创建文本子节点，插入dom树中
      nodeOps.appendChild(vnode.elm, nodeOps.createTextNode(String(vnode.text)))
    }
  }

  function isPatchable (vnode) {
    while (vnode.componentInstance) {
      vnode = vnode.componentInstance._vnode
    }
    return isDef(vnode.tag)
  }

	// 触发`create`钩子的方法
  function invokeCreateHooks (vnode, insertedVnodeQueue) {
		// 遍历内置的`create`钩子函数，全部触发
    for (let i = 0; i < cbs.create.length; ++i) {
      cbs.create[i](emptyNode, vnode)
    }
		// 触发vnode中的`create`钩子函数
    i = vnode.data.hook // Reuse variable
    if (isDef(i)) {
			// 如果vnode中的`create`钩子函数存在，则触发vnode中的`create`钩子函数
      if (isDef(i.create)) i.create(emptyNode, vnode)
			// 将vnode推入插入节点队列
      if (isDef(i.insert)) insertedVnodeQueue.push(vnode)
    }
  }

  // set scope id attribute for scoped CSS.
  // this is implemented as a special case to avoid the overhead
  // of going through the normal attribute patching process.
	// 设置样式作用域
  function setScope (vnode) {
    let i
    if (isDef(i = vnode.fnScopeId)) {
      nodeOps.setStyleScope(vnode.elm, i)
    } else {
      let ancestor = vnode
      while (ancestor) {
        if (isDef(i = ancestor.context) && isDef(i = i.$options._scopeId)) {
          nodeOps.setStyleScope(vnode.elm, i)
        }
        ancestor = ancestor.parent
      }
    }
    // for slot content they should also get the scopeId from the host instance.
    if (isDef(i = activeInstance) &&
      i !== vnode.context &&
      i !== vnode.fnContext &&
      isDef(i = i.$options._scopeId)
    ) {
      nodeOps.setStyleScope(vnode.elm, i)
    }
  }

	// 为父节点添加子节点
  function addVnodes (parentElm, refElm, vnodes, startIdx, endIdx, insertedVnodeQueue) {
    for (; startIdx <= endIdx; ++startIdx) {
      createElm(vnodes[startIdx], insertedVnodeQueue, parentElm, refElm, false, vnodes, startIdx)
    }
  }

	// 触发`destroy`钩子
  function invokeDestroyHook (vnode) {
    let i, j
    const data = vnode.data
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.destroy)) i(vnode)
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode)
    }
    if (isDef(i = vnode.children)) {
      for (j = 0; j < vnode.children.length; ++j) {
        invokeDestroyHook(vnode.children[j])
      }
    }
  }

	// 删除虚拟dom节点vnode
  function removeVnodes (vnodes, startIdx, endIdx) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx]
      if (isDef(ch)) {
        if (isDef(ch.tag)) {
          removeAndInvokeRemoveHook(ch)
          invokeDestroyHook(ch)
        } else { // Text node
          removeNode(ch.elm)
        }
      }
    }
  }

	// 删除真实dom节点，并触发`remove`钩子
  function removeAndInvokeRemoveHook (vnode, rm) {
    if (isDef(rm) || isDef(vnode.data)) {
      let i
      const listeners = cbs.remove.length + 1
      if (isDef(rm)) {
        // we have a recursively passed down rm callback
        // increase the listeners count
        rm.listeners += listeners
      } else {
        // directly removing
        rm = createRmCb(vnode.elm, listeners)
      }
      // recursively invoke hooks on child component root node
      if (isDef(i = vnode.componentInstance) && isDef(i = i._vnode) && isDef(i.data)) {
        removeAndInvokeRemoveHook(i, rm)
      }
      for (i = 0; i < cbs.remove.length; ++i) {
        cbs.remove[i](vnode, rm)
      }
      if (isDef(i = vnode.data.hook) && isDef(i = i.remove)) {
        i(vnode, rm)
      } else {
        rm()
      }
    } else {
      removeNode(vnode.elm)
    }
  }

	// 更新子节点
  function updateChildren (parentElm, oldCh, newCh, insertedVnodeQueue, removeOnly) {
    let oldStartIdx = 0
    let newStartIdx = 0
    let oldEndIdx = oldCh.length - 1
    let oldStartVnode = oldCh[0]
    let oldEndVnode = oldCh[oldEndIdx]
    let newEndIdx = newCh.length - 1
    let newStartVnode = newCh[0]
    let newEndVnode = newCh[newEndIdx]
    let oldKeyToIdx, idxInOld, vnodeToMove, refElm

    // removeOnly is a special flag used only by <transition-group>
    // to ensure removed elements stay in correct relative positions
    // during leaving transitions
    const canMove = !removeOnly

    if (process.env.NODE_ENV !== 'production') {
      checkDuplicateKeys(newCh)
    }

    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      if (isUndef(oldStartVnode)) {
        oldStartVnode = oldCh[++oldStartIdx] // Vnode has been moved left
      } else if (isUndef(oldEndVnode)) {
        oldEndVnode = oldCh[--oldEndIdx]
      } else if (sameVnode(oldStartVnode, newStartVnode)) {
        patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
        oldStartVnode = oldCh[++oldStartIdx]
        newStartVnode = newCh[++newStartIdx]
      } else if (sameVnode(oldEndVnode, newEndVnode)) {
        patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue, newCh, newEndIdx)
        oldEndVnode = oldCh[--oldEndIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldStartVnode, newEndVnode)) { // Vnode moved right
        patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue, newCh, newEndIdx)
        canMove && nodeOps.insertBefore(parentElm, oldStartVnode.elm, nodeOps.nextSibling(oldEndVnode.elm))
        oldStartVnode = oldCh[++oldStartIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldEndVnode, newStartVnode)) { // Vnode moved left
        patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
        canMove && nodeOps.insertBefore(parentElm, oldEndVnode.elm, oldStartVnode.elm)
        oldEndVnode = oldCh[--oldEndIdx]
        newStartVnode = newCh[++newStartIdx]
      } else {
        if (isUndef(oldKeyToIdx)) oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx)
        idxInOld = isDef(newStartVnode.key)
          ? oldKeyToIdx[newStartVnode.key]
          : findIdxInOld(newStartVnode, oldCh, oldStartIdx, oldEndIdx)
        if (isUndef(idxInOld)) { // New element
          createElm(newStartVnode, insertedVnodeQueue, parentElm, oldStartVnode.elm, false, newCh, newStartIdx)
        } else {
          vnodeToMove = oldCh[idxInOld]
          if (sameVnode(vnodeToMove, newStartVnode)) {
            patchVnode(vnodeToMove, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
            oldCh[idxInOld] = undefined
            canMove && nodeOps.insertBefore(parentElm, vnodeToMove.elm, oldStartVnode.elm)
          } else {
            // same key but different element. treat as new element
            createElm(newStartVnode, insertedVnodeQueue, parentElm, oldStartVnode.elm, false, newCh, newStartIdx)
          }
        }
        newStartVnode = newCh[++newStartIdx]
      }
    }
    if (oldStartIdx > oldEndIdx) {
      refElm = isUndef(newCh[newEndIdx + 1]) ? null : newCh[newEndIdx + 1].elm
      addVnodes(parentElm, refElm, newCh, newStartIdx, newEndIdx, insertedVnodeQueue)
    } else if (newStartIdx > newEndIdx) {
      removeVnodes(oldCh, oldStartIdx, oldEndIdx)
    }
  }

	// 检查虚拟dom节点的key是否重复
  function checkDuplicateKeys (children) {
		// 创建节点去重字典
    const seenKeys = {}
		// 遍历子节点，查找重复节点
    for (let i = 0; i < children.length; i++) {
			// 获取子节点引用
      const vnode = children[i]
			// 获取子节点key
      const key = vnode.key
			// 如果没有子节点没有设置key值，则直接返回
      if (isDef(key)) {
				// 如果发现重复节点，则提示警告信息
        if (seenKeys[key]) {
          warn(
            `Duplicate keys detected: '${key}'. This may cause an update error.`,
            vnode.context
          )
        }
				// 否则将当前key值加入去重字典
				else {
          seenKeys[key] = true
        }
      }
    }
  }

	// 获取虚拟dom子节点在旧虚拟dom节点中的索引
  function findIdxInOld (node, oldCh, start, end) {
    for (let i = start; i < end; i++) {
      const c = oldCh[i]
      if (isDef(c) && sameVnode(node, c)) return i
    }
  }

	// 合并虚拟dom节点，并将变化渲染到真实dom
  function patchVnode (
    oldVnode,
    vnode,
    insertedVnodeQueue,
    ownerArray,
    index,
    removeOnly
  ) {
    if (oldVnode === vnode) {
      return
    }

    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // clone reused vnode
      vnode = ownerArray[index] = cloneVNode(vnode)
    }

    const elm = vnode.elm = oldVnode.elm

    if (isTrue(oldVnode.isAsyncPlaceholder)) {
      if (isDef(vnode.asyncFactory.resolved)) {
        hydrate(oldVnode.elm, vnode, insertedVnodeQueue)
      } else {
        vnode.isAsyncPlaceholder = true
      }
      return
    }

    // reuse element for static trees.
    // note we only do this if the vnode is cloned -
    // if the new node is not cloned it means the render functions have been
    // reset by the hot-reload-api and we need to do a proper re-render.
    if (isTrue(vnode.isStatic) &&
      isTrue(oldVnode.isStatic) &&
      vnode.key === oldVnode.key &&
      (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
    ) {
      vnode.componentInstance = oldVnode.componentInstance
      return
    }

    let i
    const data = vnode.data
    if (isDef(data) && isDef(i = data.hook) && isDef(i = i.prepatch)) {
      i(oldVnode, vnode)
    }

    const oldCh = oldVnode.children
    const ch = vnode.children
    if (isDef(data) && isPatchable(vnode)) {
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode)
      if (isDef(i = data.hook) && isDef(i = i.update)) i(oldVnode, vnode)
    }
    if (isUndef(vnode.text)) {
      if (isDef(oldCh) && isDef(ch)) {
        if (oldCh !== ch) updateChildren(elm, oldCh, ch, insertedVnodeQueue, removeOnly)
      } else if (isDef(ch)) {
        if (process.env.NODE_ENV !== 'production') {
          checkDuplicateKeys(ch)
        }
        if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, '')
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue)
      } else if (isDef(oldCh)) {
        removeVnodes(oldCh, 0, oldCh.length - 1)
      } else if (isDef(oldVnode.text)) {
        nodeOps.setTextContent(elm, '')
      }
    } else if (oldVnode.text !== vnode.text) {
      nodeOps.setTextContent(elm, vnode.text)
    }
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.postpatch)) i(oldVnode, vnode)
    }
  }

	// 触发`insert`钩子
  function invokeInsertHook (vnode, queue, initial) {
    // delay insert hooks for component root nodes, invoke them after the
    // element is really inserted
		// 如果是延迟加载的组件根元素，且有父节点，则不会立即调用vnode的`insert`钩子
    if (isTrue(initial) && isDef(vnode.parent)) {
			// 将父虚拟dom节点的等待插入节点设置为当前虚拟dom节点
      vnode.parent.data.pendingInsert = queue
    }
		// 如果不是延迟加载的组件根节点或没有父节点，则遍历`insertedVnodeQueue`，触发所有插入节点的`insert`钩子
		else {
      for (let i = 0; i < queue.length; ++i) {
        queue[i].data.hook.insert(queue[i])
      }
    }
  }

  let hydrationBailed = false
  // list of modules that can skip create hook during hydration because they
  // are already rendered on the client or has no need for initialization
  // Note: style is excluded because it relies on initial clone for future
  // deep updates (#7063).
  const isRenderedModule = makeMap('attrs,class,staticClass,staticStyle,key')

  // Note: this is a browser-only function so we can assume elms are DOM nodes.
  function hydrate (elm, vnode, insertedVnodeQueue, inVPre) {
    let i
    const { tag, data, children } = vnode
    inVPre = inVPre || (data && data.pre)
    vnode.elm = elm

    if (isTrue(vnode.isComment) && isDef(vnode.asyncFactory)) {
      vnode.isAsyncPlaceholder = true
      return true
    }
    // assert node match
    if (process.env.NODE_ENV !== 'production') {
      if (!assertNodeMatch(elm, vnode, inVPre)) {
        return false
      }
    }
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.init)) i(vnode, true /* hydrating */)
      if (isDef(i = vnode.componentInstance)) {
        // child component. it should have hydrated its own tree.
        initComponent(vnode, insertedVnodeQueue)
        return true
      }
    }
    if (isDef(tag)) {
      if (isDef(children)) {
        // empty element, allow client to pick up and populate children
        if (!elm.hasChildNodes()) {
          createChildren(vnode, children, insertedVnodeQueue)
        } else {
          // v-html and domProps: innerHTML
          if (isDef(i = data) && isDef(i = i.domProps) && isDef(i = i.innerHTML)) {
            if (i !== elm.innerHTML) {
              /* istanbul ignore if */
              if (process.env.NODE_ENV !== 'production' &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('server innerHTML: ', i)
                console.warn('client innerHTML: ', elm.innerHTML)
              }
              return false
            }
          } else {
            // iterate and compare children lists
            let childrenMatch = true
            let childNode = elm.firstChild
            for (let i = 0; i < children.length; i++) {
              if (!childNode || !hydrate(childNode, children[i], insertedVnodeQueue, inVPre)) {
                childrenMatch = false
                break
              }
              childNode = childNode.nextSibling
            }
            // if childNode is not null, it means the actual childNodes list is
            // longer than the virtual children list.
            if (!childrenMatch || childNode) {
              /* istanbul ignore if */
              if (process.env.NODE_ENV !== 'production' &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('Mismatching childNodes vs. VNodes: ', elm.childNodes, children)
              }
              return false
            }
          }
        }
      }
      if (isDef(data)) {
        let fullInvoke = false
        for (const key in data) {
          if (!isRenderedModule(key)) {
            fullInvoke = true
            invokeCreateHooks(vnode, insertedVnodeQueue)
            break
          }
        }
        if (!fullInvoke && data['class']) {
          // ensure collecting deps for deep class bindings for future updates
          traverse(data['class'])
        }
      }
    } else if (elm.data !== vnode.text) {
      elm.data = vnode.text
    }
    return true
  }

	// ssr渲染时，判断是否时相同节点
  function assertNodeMatch (node, vnode, inVPre) {
    if (isDef(vnode.tag)) {
      return vnode.tag.indexOf('vue-component') === 0 || (
        !isUnknownElement(vnode, inVPre) &&
        vnode.tag.toLowerCase() === (node.tagName && node.tagName.toLowerCase())
      )
    } else {
      return node.nodeType === (vnode.isComment ? 8 : 3)
    }
  }

	// 将虚拟dom渲染成真实dom
  return function patch (
		oldVnode, // 旧的虚拟dom节点或真实dom节点
		vnode, // 新的虚拟dom节点
		hydrating, // 是否需要ssr
		removeOnly // 只进行移除操作
	) {
		// 如果新的vnode不存在，则直接返回
    if (isUndef(vnode)) {
			// 如果旧vnode或真实dom存在，则触发`destroy`钩子
      if (isDef(oldVnode)) invokeDestroyHook(oldVnode)
			// 直接返回
      return
    }

		// 标记初始化渲染为false
    let isInitialPatch = false
		// 初始化插入节点为空数组，将来会触发vnode的`insert`钩子函数
    const insertedVnodeQueue = []

		// 如果oldVnode不存在，则直接根据新的vnode创建真实dom节点
    if (isUndef(oldVnode)) {
      // empty mount (likely as component), create new root element
			// 调用vm.$mount但不传入参数时，会根据vnode创建真实dom树，但不会挂载到页面上，只会暂存到内存中
			// 将初始化渲染标识置为true，表示只是创建出真实dom节点，并没有挂载到界面
      isInitialPatch = true
			// 根据新vnode，创建真实dom节点
      createElm(vnode, insertedVnodeQueue)
    }
		// 如果oldVnode存在，则将新旧vnode进行对比，将差异渲染到真实dom
		else {
			// 判断oldVnode是否是真实dom
      const isRealElement = isDef(oldVnode.nodeType)
			// 如果oldVnode不是真实dom，且新旧vnode是相同节点，则合并新旧节点，并渲染到真实dom
      if (!isRealElement && sameVnode(oldVnode, vnode)) {
        // patch existing root node
        patchVnode(oldVnode, vnode, insertedVnodeQueue, null, null, removeOnly)
      }
			// 否则根据新vnode创建真实dom节点，替换旧的真实dom节点
			else {
				// 如果oldVnode是真实dom，则将oldVnode置为空
        if (isRealElement) {
          // mounting to a real element
          // check if this is server-rendered content and if we can perform
          // a successful hydration.
					// 如果oldVnode是元素节点，且有SSR标记，则删除元素的SSR标记，并将本次渲染的SSR标识置为true
          if (oldVnode.nodeType === 1 && oldVnode.hasAttribute(SSR_ATTR)) {
            oldVnode.removeAttribute(SSR_ATTR)
            hydrating = true
          }
					// 如果设置了渲染的SSR标记，则进行SSR渲染
          if (isTrue(hydrating)) {
						// 如果SSR渲染成功，则返回oldVnode
            if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
							// 触发`insert`钩子
              invokeInsertHook(vnode, insertedVnodeQueue, true)
							// 返回oldVnode
              return oldVnode
            }
						// 如果SSR渲染失败，且当前环境为开发环境，则提示警告信息
						else if (process.env.NODE_ENV !== 'production') {
              warn(
                'The client-side rendered virtual DOM tree is not matching ' +
                'server-rendered content. This is likely caused by incorrect ' +
                'HTML markup, for example nesting block-level elements inside ' +
                '<p>, or missing <tbody>. Bailing hydration and performing ' +
                'full client-side render.'
              )
            }
          }
          // either not server-rendered, or hydration failed.
          // create an empty node and replace it
					// 将作为真实dom的oldVnode转换为空的虚拟dom节点
          oldVnode = emptyNodeAt(oldVnode)
        }

        // replacing existing element
				// 获取oldVnode对应的真实dom节点
        const oldElm = oldVnode.elm
				// 获取旧真实dom节点的父节点，为将来替换真实dom节点做准备
        const parentElm = nodeOps.parentNode(oldElm)

        // create new node
				// 根据新vnode创建真实dom
        createElm(
          vnode, // 虚拟dom节点
          insertedVnodeQueue, // 插入节点队列
          // extremely rare edge case: do not insert if old element is in a
          // leaving transition. Only happens when combining transition +
          // keep-alive + HOCs. (#4590)
					// 当dom节点正在执行transition过渡动画时，不会将创建的新真实dom节点挂载到父节点
          oldElm._leaveCb ? null : parentElm, // 父节点
          nodeOps.nextSibling(oldElm) // 相邻参考节点
        )

        // update parent placeholder node element, recursively
        if (isDef(vnode.parent)) {
          let ancestor = vnode.parent
          const patchable = isPatchable(vnode)
          while (ancestor) {
            for (let i = 0; i < cbs.destroy.length; ++i) {
              cbs.destroy[i](ancestor)
            }
            ancestor.elm = vnode.elm
            if (patchable) {
              for (let i = 0; i < cbs.create.length; ++i) {
                cbs.create[i](emptyNode, ancestor)
              }
              // #6513
              // invoke insert hooks that may have been merged by create hooks.
              // e.g. for directives that uses the "inserted" hook.
              const insert = ancestor.data.hook.insert
              if (insert.merged) {
                // start at index 1 to avoid re-invoking component mounted hook
                for (let i = 1; i < insert.fns.length; i++) {
                  insert.fns[i]()
                }
              }
            } else {
              registerRef(ancestor)
            }
            ancestor = ancestor.parent
          }
        }

        // destroy old node
				// 如果存在父节点真实dom，则删除oldVnode，并触发节点的`remove`钩子函数和Vue实例的`destory`钩子函数
        if (isDef(parentElm)) {
          removeVnodes([oldVnode], 0, 0)
        }
				// 如果是根据虚拟dom节点，触发`destroy`钩子
				else if (isDef(oldVnode.tag)) {
          invokeDestroyHook(oldVnode)
        }
      }
    }
		// 触发`insert`钩子
    invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch)
		// 返回新vnode映射的真实dom节点
    return vnode.elm
  }
}
