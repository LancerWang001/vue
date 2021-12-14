/* @flow */

import { namespaceMap } from 'web/util/index'

// 创建dom节点
export function createElement (tagName: string, vnode: VNode): Element {
  const elm = document.createElement(tagName)
  if (tagName !== 'select') {
    return elm
  }
  // false or null will remove the attribute but undefined will not
  if (vnode.data && vnode.data.attrs && vnode.data.attrs.multiple !== undefined) {
    elm.setAttribute('multiple', 'multiple')
  }
  return elm
}

// 创建svg标签或math标签
export function createElementNS (namespace: string, tagName: string): Element {
  return document.createElementNS(namespaceMap[namespace], tagName)
}

// 创建文本节点
export function createTextNode (text: string): Text {
  return document.createTextNode(text)
}

// 创建注释节点
export function createComment (text: string): Comment {
  return document.createComment(text)
}

// 在指定dom节点的指定位置插入dom元素
export function insertBefore (parentNode: Node, newNode: Node, referenceNode: Node) {
  parentNode.insertBefore(newNode, referenceNode)
}

// 从指定dom节点上移除子元素
export function removeChild (node: Node, child: Node) {
  node.removeChild(child)
}

// 为指定dom节点添加子元素
export function appendChild (node: Node, child: Node) {
  node.appendChild(child)
}

// 获取dom节点的父节点
export function parentNode (node: Node): ?Node {
  return node.parentNode
}

// 获取dom节点的相邻节点
export function nextSibling (node: Node): ?Node {
  return node.nextSibling
}

// 获取dom节点的标签名
export function tagName (node: Element): string {
  return node.tagName
}

// 为dom节点设置文本子节点
export function setTextContent (node: Node, text: string) {
  node.textContent = text
}

// 为dom节点设置样式范围
export function setStyleScope (node: Element, scopeId: string) {
  node.setAttribute(scopeId, '')
}
