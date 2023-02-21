import type { OptionsType, MicroAppConfigType, lifeCyclesType, plugins, fetchType, AppInterface } from '@micro-app/types'
import { defineElement } from './micro_app_element'
import preFetch, { getGlobalAssets } from './prefetch'
import { logError, logWarn, isFunction, isBrowser, isPlainObject, formatAppName, getRootContainer } from './libs/utils'
import { EventCenterForBaseApp } from './interact'
import { initGlobalEnv } from './libs/global_env'
import { appInstanceMap } from './create_app'
import { appStates, keepAliveStates } from './constants'

/**
 * if app not prefetch & not unmount, then app is active
 * @param excludeHiddenApp exclude hidden keep-alive app, default is false
 * @returns active apps
 */
export function getActiveApps (excludeHiddenApp?: boolean): string[] {
  const activeApps: string[] = []
  appInstanceMap.forEach((app: AppInterface, appName: string) => {
    if (
      appStates.UNMOUNT !== app.getAppState() &&
      !app.isPrefetch &&
      (
        !excludeHiddenApp ||
        keepAliveStates.KEEP_ALIVE_HIDDEN !== app.getKeepAliveState()
      )
    ) {
      activeApps.push(appName)
    }
  })

  return activeApps
}

// get all registered apps
export function getAllApps (): string[] {
  return Array.from(appInstanceMap.keys())
}

export interface unmountAppParams {
  destroy?: boolean // destroy app, default is false
  clearAliveState?: boolean // clear keep-alive app state, default is false
}

/**
 * unmount app by appName
 * @param appName
 * @param options unmountAppParams
 * @returns Promise<void>
 */
export function unmountApp (appName: string, options?: unmountAppParams): Promise<void> {
  const app = appInstanceMap.get(formatAppName(appName))
  return new Promise((resolve) => { // eslint-disable-line
    if (app) {
      if (app.getAppState() === appStates.UNMOUNT || app.isPrefetch) {
        if (options?.destroy) {
          app.actionsForCompletelyDestroy()
        }
        resolve()
      } else if (app.getKeepAliveState() === keepAliveStates.KEEP_ALIVE_HIDDEN) {
        if (options?.destroy) {
          app.unmount(true, resolve)
        } else if (options?.clearAliveState) {
          app.unmount(false, resolve)
        } else {
          resolve()
        }
      } else {
        const container = getRootContainer(app.container!)
        const unmountHandler = () => {
          container.removeEventListener('unmount', unmountHandler)
          container.removeEventListener('afterhidden', afterhiddenHandler)
          resolve()
        }

        const afterhiddenHandler = () => {
          container.removeEventListener('unmount', unmountHandler)
          container.removeEventListener('afterhidden', afterhiddenHandler)
          resolve()
        }

        container.addEventListener('unmount', unmountHandler)
        container.addEventListener('afterhidden', afterhiddenHandler)

        if (options?.destroy) {
          let destroyAttrValue, destoryAttrValue
          container.hasAttribute('destroy') && (destroyAttrValue = container.getAttribute('destroy'))
          container.hasAttribute('destory') && (destoryAttrValue = container.getAttribute('destory'))

          container.setAttribute('destroy', 'true')
          container.parentNode!.removeChild(container)
          container.removeAttribute('destroy')

          typeof destroyAttrValue === 'string' && container.setAttribute('destroy', destroyAttrValue)
          typeof destoryAttrValue === 'string' && container.setAttribute('destory', destoryAttrValue)
        } else if (options?.clearAliveState && container.hasAttribute('keep-alive')) {
          const keepAliveAttrValue = container.getAttribute('keep-alive')!

          container.removeAttribute('keep-alive')
          container.parentNode!.removeChild(container)

          container.setAttribute('keep-alive', keepAliveAttrValue)
        } else {
          container.parentNode!.removeChild(container)
        }
      }
    } else {
      logWarn(`app ${appName} does not exist`)
      resolve()
    }
  })
}

// unmount all apps in turn
export function unmountAllApps (options?: unmountAppParams): Promise<void> {
  return Array.from(appInstanceMap.keys()).reduce((pre, next) => pre.then(() => unmountApp(next, options)), Promise.resolve())
}

export class MicroApp extends EventCenterForBaseApp implements MicroAppConfigType {
  // NOTE-CR: 格式化默认参数
  tagName = 'micro-app'
  shadowDOM?: boolean
  destroy?: boolean
  inline?: boolean
  disableScopecss?: boolean
  disableSandbox?: boolean
  ssr?: boolean
  lifeCycles?: lifeCyclesType
  plugins?: plugins
  fetch?: fetchType
  preFetch = preFetch
  excludeAssetFilter?: (assetUrl: string) => boolean
  // NOTE-CR: 入口函数
  start (options?: OptionsType): void {
    if (!isBrowser || !window.customElements) {
      return logError('micro-app is not supported in this environment')
    }

    // NOTE-CR: 根据选项修改展示的tagName
    if (options?.tagName) {
      if (/^micro-app(-\S+)?/.test(options.tagName)) {
        this.tagName = options.tagName
      } else {
        return logError(`${options.tagName} is invalid tagName`)
      }
    }

    // NOTE-CR: 判断当前自定义标签是否被注册
    if (window.customElements.get(this.tagName)) {
      return logWarn(`element ${this.tagName} is already defined`)
    }

    // NOTE-CR: 初始化全局环境变量
    initGlobalEnv()

    // NOTE-CR: 初始化参数
    if (options && isPlainObject(options)) {
      this.shadowDOM = options.shadowDOM
      this.destroy = options.destroy
      /**
       * compatible with versions below 0.4.2 of destroy
       * do not merge with the previous line
       */
      // @ts-ignore
      this.destory = options.destory
      // NOTE-CR: inline 属性决定了 script 标签在内存还是在数据标签中执行JS代码
      this.inline = options.inline
      this.disableScopecss = options.disableScopecss
      this.disableSandbox = options.disableSandbox
      this.ssr = options.ssr
      // NOTE-CR: 自定义 fetch 函数
      isFunction(options.fetch) && (this.fetch = options.fetch)
      // NOTE-CR: 生命周期
      isPlainObject(options.lifeCycles) && (this.lifeCycles = options.lifeCycles)
      // NOTE-CR: 初始化预加载参数
      // load app assets when browser is idle
      options.preFetchApps && preFetch(options.preFetchApps)

      // load global assets when browser is idle
      options.globalAssets && getGlobalAssets(options.globalAssets)

      isFunction(options.excludeAssetFilter) && (this.excludeAssetFilter = options.excludeAssetFilter)

      if (isPlainObject(options.plugins)) {
        const modules = options.plugins!.modules
        if (isPlainObject(modules)) {
          for (const appName in modules) {
            const formattedAppName = formatAppName(appName)
            if (formattedAppName && appName !== formattedAppName) {
              modules[formattedAppName] = modules[appName]
              delete modules[appName]
            }
          }
        }

        this.plugins = options.plugins
      }
    }

    // NOTE-CR: 注册自定义组件
    // define customElement after init
    defineElement(this.tagName)
  }
}

export default new MicroApp()
