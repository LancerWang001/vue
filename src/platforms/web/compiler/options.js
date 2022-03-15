/* @flow */

import {
  isPreTag,
  mustUseProp,
  isReservedTag,
  getTagNamespace
} from '../util/index'

import modules from './modules/index'
import directives from './directives/index'
import { genStaticKeys } from 'shared/util'
import { isUnaryTag, canBeLeftOpenTag } from './util'

export const baseOptions: CompilerOptions = {
  expectHTML: true,
  modules,
  directives, // 指令
  isPreTag, // 是否是pre标签
  isUnaryTag, // 是否是自闭合标签
  mustUseProp, // 是否必须使用props
  canBeLeftOpenTag, // 非单标签，但可以自闭合（浏览器自动补全）
  isReservedTag, // 内部保留标签
  getTagNamespace, // 获取标签的命名空间，即svg标签和math标签的xml头信息
  staticKeys: genStaticKeys(modules)
}
