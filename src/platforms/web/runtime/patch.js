/* @flow */

import * as nodeOps from 'web/runtime/node-ops'
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index'
import platformModules from 'web/runtime/modules/index'

/**
 * @const nodeOps
 * @description dom操作集合
 * @property {Function} createElement 创建dom节点
 * @property {Function} createElementNS 创建svg标签或math标签
 * @property {Function} createTextNode 创建文本节点
 * @property {Function} createComment 创建注释节点
 * @property {Function} insertBefore 在指定dom节点的指定位置插入dom元素
 * @property {Function} removeChild 从指定dom节点上移除子元素
 * @property {Function} appendChild 为指定dom节点添加子元素
 * @property {Function} parentNode 获取dom节点的父节点
 * @property {Function} nextSibling 获取dom节点的相邻节点
 * @property {Function} tagName 获取dom节点的标签名
 * @property {Function} setTextContent 为dom节点设置文本子节点
 */

/**
 * @typedef ModuleAction
 * @property {Function} create 新建操作
 * @property {Funciton} update 更新操作
 * @property {Function} destroy 销毁操作
 */

/**
 * @const platformModules
 * @description 平台相关的操作集合
 * @property {ModuleAction} attrs 标签属性相关操作
 * @property {ModuleAction} klass class样式类相关操作
 * @property {ModuleAction} events dom事件相关操作
 * @property {ModuleAction} domProps dom属性相关操作
 * @property {ModuleAction} style dom行内样式相关操作
 * @property {ModuleAction} transition dom过渡效果相关操作
 */

/**
 * @const baseModules
 * @description 基础操作集合
 * @property {ModuleAction} ref Vue.prototype.$ref相关操作
 * @property {ModuleAction} directives Vue指令相关操作
 */

// the directive module should be applied last, after all
// built-in modules have been applied.
const modules = platformModules.concat(baseModules)

export const patch: Function = createPatchFunction({ nodeOps, modules })
