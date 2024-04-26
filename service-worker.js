/**
 * @type { ServiceWorkerGlobalScope } 提供ServiceWorker的代码提示
 */
const self = globalThis;
// 以副作用导入typescript，以保证require也可以同步使用
import "./game/typescript.js";

/**
 * @type { import("typescript") }
 */
const ts = globalThis.ts;
// sfc以正常的esmodule使用
import * as sfc from "./game/compiler-sfc.esm-browser.js";
if (typeof ts != "undefined") {
	console.log(`ts loaded`, ts.version);
} else {
	console.error(`ts undefined`);
}

if (typeof sfc != "undefined") {
	console.log(`sfc loaded`, sfc.version);
	sfc.registerTS(() => ts);
} else {
	console.error(`sfc undefined`);
}

console.log("serviceWorker version 2.3");

// 定义一个基于cache的db
self.CACHE_DB_NAME = "SWHelperCache";
self.db = {
	read: (key) => {
		return new Promise((resolve, reject) => {
			caches
				.match(new Request(`https://LOCALCACHE/${encodeURIComponent(key)}`))
				.then(function (res) {
					res.text().then((text) => resolve(text));
				})
				.catch(() => {
					resolve(null);
				});
		});
	},
	read_arrayBuffer: (key) => {
		return new Promise((resolve, reject) => {
			caches
				.match(new Request(`https://LOCALCACHE/${encodeURIComponent(key)}`))
				.then(function (res) {
					res.arrayBuffer().then((aB) => resolve(aB));
				})
				.catch(() => {
					resolve(null);
				});
		});
	},
	write: (key, value) => {
		return new Promise((resolve, reject) => {
			caches
				.open(self.CACHE_DB_NAME)
				.then(function (cache) {
					cache
						.put(
							new Request(`https://LOCALCACHE/${encodeURIComponent(key)}`),
							new Response(value)
						)
						.then((r) => resolve());
				})
				.catch(() => {
					reject();
				});
		});
	},
};

// 定义 CACHE_NAME 来存储和检索缓存
self.CACHE_NAME = "cache-v1-";
self.CACHE_STATIC_NAME = "cache-v1-static";
self.CACHE_OFFLINE_NAME = "cache-v1-offline";

const getVersion = async () => {
	const request = new Request("./version.json", {
		cache: "no-store",
	});
	const versionResponse = await fetchAndCacheOffline(request);
	const versionData = await versionResponse.json();
	self.version = versionData.version + "." + versionData.extVersion;
	console.log("当前版本号: " + self.version);
	self.db
		.read("version")
		.then((version) => {
			if (version !== self.version) {
				console.log("版本升级 " + version + " => " + self.version + " ");
				// 定义一个允许保留的白名单
				const cacheWhitelist = [
					self.CACHE_DB_NAME,
					self.CACHE_STATIC_NAME,
					self.CACHE_NAME + self.version,
				];
				caches.keys().then((cacheNames) => {
					return Promise.all(
						cacheNames.map((cacheName) => {
							if (cacheWhitelist.indexOf(cacheName) === -1) {
								// 删除不在白名单的缓存
								return caches.delete(cacheName);
							}
						})
					);
				});
			}
		})
		.then(() => {
			self.db.write("version", self.version);
		});
	return self.version;
};

const fetchAndCache = (event, request, version) => {
	return event.respondWith(
		// 在所有缓存中查询
		caches.match(request).then((cachedResponse) => {
			if (cachedResponse) {
				// 如果在缓存中找到了资源，直接返回
				return cachedResponse;
			}

			// 否则，继续从网络获取资源，并将其添加到缓存中
			return fetch(request).then((networkResponse) => {
				// 只缓存状态为 200 的响应
				if (networkResponse.status === 200) {
					// 根据参数version判断是放入静态文件缓存还是版本缓存
					return caches
						.open(version ? self.CACHE_NAME + version : self.CACHE_STATIC_NAME)
						.then((cache) => {
							cache.put(request, networkResponse.clone()).then();
							return networkResponse;
						});
				}
				return networkResponse;
			});
		})
	);
};

const fetchAndCacheOffline = (request) => {
	return fetch(request)
		.then((networkResponse) => {
			// 只缓存状态为 200 的响应
			if (networkResponse.status === 200 && request.url.startsWith("http")) {
				return caches.open(self.CACHE_OFFLINE_NAME).then((cache) => {
					cache.put(request, networkResponse.clone());
					return networkResponse;
				});
			}
			// 返回其他状态的响应
			return networkResponse;
		})
		.catch(async (error) => {
			// 检查异常是否是因为用户脱机
			if (error instanceof TypeError && !navigator.onLine) {
				// 脱机状态，返回缓存的离线页面
				const cache = await caches.open(self.CACHE_OFFLINE_NAME);
				return await cache.match(request);
			} else {
				// 其他类型的异常，可以决定如何处理
				throw error; // 或者返回其他备用响应
			}
		});
};

const checkVersion = () => {
	if (typeof self.version === "undefined") {
		return getVersion();
	} else {
		// 如果 version 已经定义，立即解析 Promise
		return Promise.resolve(self.version);
	}
};

self.addEventListener("install", (event) => {
	// The promise that skipWaiting() returns can be safely ignored.
	event.waitUntil(
		self.skipWaiting().then(() => {
			getVersion().then(() => {
				caches.open(self.CACHE_NAME + self.version).then((cache) => {
					return cache.addAll([
						// 列出要缓存的文件
					]);
				});
			});
		})
	);
});

// 监听 'activate' 事件以清理旧缓存
self.addEventListener("activate", (event) => {
	event.waitUntil(getVersion());
	// 定义一个允许保留的白名单
	const cacheWhitelist = [
		self.CACHE_DB_NAME,
		self.CACHE_STATIC_NAME,
		self.CACHE_NAME + self.version,
		self.CACHE_OFFLINE_NAME,
	];
	console.log("清理旧缓存，白名单为: " + cacheWhitelist);
	caches.keys().then((cacheNames) => {
		return Promise.all(
			cacheNames.map((cacheName) => {
				if (cacheWhitelist.indexOf(cacheName) === -1) {
					// 删除不在白名单的缓存
					return caches.delete(cacheName);
				}
			})
		);
	});
	// 当一个 service worker 被初始注册时，页面在下次加载之前不会使用它。 claim() 方法会立即控制这些页面
	event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
	console.log(event.data);
});

// 监听 'fetch' 事件以拦截网络请求
self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);

	if (!url.protocol.startsWith("http")) {
		console.log("非http请求直接进行请求" + url);
		return event.respondWith(fetchAndCacheOffline(event.request));
	}

	if (url.href === self.registration.scope) {
		console.log("根路径为: " + url.href);
		self.db.write("rootUrl", url.href);
		// 进入首页时触发一次获取版本号
		event.waitUntil(getVersion());
		return event.respondWith(fetchAndCacheOffline(event.request));
	}

	// 检查请求是否为 GET，URL 是否有查询参数，以及文件后缀
	if (
		request.method !== "GET" ||
		url.search || // 检查 URL 是否包含查询参数
		/\.(js|css|vue|ts|json)$/.test(url.pathname) // 检查文件后缀是否为 .js, .css, .vue, .ts, .json
	) {
		// 这些请求交给第二个fetch监听器处理
		return;
	}

	// 到这里的都是静态资源文件
	// 请求并缓存到静态文件缓存中
	return fetchAndCache(event, request);
});

/**
 * 将vue编译的结果放在这里，调用的时候直接返回就好了
 */
// TODO 使用上面的DB缓存
const vueFileMap = new Map();

// 能到第二个fetch监听器的都是js|css|vue|ts|json之类的文件或者不是get方法或者有参数的
self.addEventListener("fetch", (event) => {
	let request = event.request;
	if (typeof request.url != "string") return console.log(request);
	// 直接替换request和url
	let url = new URL(event.request.url);
	// 为这些请求添加版本号
	url.searchParams.set("v", self.version); // 添加参数 v=xxx
	// 使用新的 URL 创建一个请求直接替换event的请求进行后续的使用
	request = new Request(url, {
		method: event.request.method,
		headers: event.request.headers,
		mode: "same-origin", // 确保请求模式相同
		credentials: event.request.credentials,
		redirect: "manual", // 因为这是一个新的请求，可能需要处理重定向
	});
	url = new URL(request.url);
	if (vueFileMap.has(request.url)) {
		const rep = new Response(new Blob([vueFileMap.get(request.url)], { type: "text/javascript" }), {
			status: 200,
			statusText: "OK",
			headers: new Headers({
				"Content-Type": "text/javascript",
			}),
		});
		event.respondWith(rep);
		return;
	}

	// 不是这几个后缀的，也不是内置的模块的指定版本然后返回
	if (
		![".ts", ".json", ".vue", "css"].some((ext) => url.pathname.endsWith(ext)) &&
		!request.url.replace(location.origin, "").startsWith("/noname-builtinModules/")
	) {
		return fetchAndCache(event, request, self.version);
	}

	// .d.ts 属于上面的漏网之鱼
	if (url.pathname.endsWith(".d.ts")) {
		return fetchAndCache(event, request, self.version);
	}
	// 如果不是请求跨域css或json时，直接请求
	if (url.pathname.endsWith(".json") || url.pathname.endsWith("css")) {
		if (!event.request.headers.get("origin")) {
			return fetchAndCache(event, request, self.version);
		}
	}
	// 能走到这里的只有
	// 1. noname-builtinModules开头的表示内置模块的
	// 2. ts、vue 需要编译的
	// 3. 跨域请求json或者css的
	if (request.url.replace(location.origin, "").startsWith("/noname-builtinModules/")) {
		const moduleName = url.pathname.replace(location.origin + "/noname-builtinModules/", "");
		console.log("正在编译", moduleName);
		let js = `const module = require('${moduleName}');\nexport default module;`;
		const rep = new Response(new Blob([js], { type: "text/javascript" }), {
			status: 200,
			statusText: "OK",
			headers: new Headers({
				"Content-Type": "text/javascript",
			}),
		});
		console.log(moduleName, "编译成功");
		event.respondWith(Promise.resolve(rep));
	} else {
		// 请求原文件
		const originRequest = new Request(request.url, {
			method: request.method,
			mode: "no-cors",
			headers: new Headers({
				"Content-Type": "text/plain",
			}),
		});
		const res = fetchAndCacheOffline(originRequest);
		// 修改请求结果
		event.respondWith(
			res
				.then((res) => {
					if (res.status !== 200) return res;
					console.log("正在编译", request.url);
					return res.text().then((text) => {
						let js = "";
						if (url.pathname.endsWith(".json")) {
							js = `export default ${text}`;
						} else if (url.pathname.endsWith(".ts")) {
							js = ts.transpile(
								text,
								{
									module: ts.ModuleKind.ES2015,
									//@todo: ES2019 -> ES2020
									target: ts.ScriptTarget.ES2019,
									inlineSourceMap: true,
									resolveJsonModule: true,
									esModuleInterop: true,
								},
								request.url
							);
						} else if (url.pathname.endsWith(".vue")) {
							const id = Date.now().toString();
							const scopeId = `data-v-${id}`;
							// 后续处理sourceMap合并
							const { descriptor } = sfc.parse(text, {
								filename: request.url,
								sourceMap: true,
							});
							// console.log({ descriptor });
							const hasScoped = descriptor.styles.some((s) => s.scoped);
							// 编译 script，因为可能有 script setup，还要进行 css 变量注入
							const script = sfc.compileScript(descriptor, {
								id: scopeId,
								inlineTemplate: true,
								templateOptions: {
									scoped: hasScoped,
									compilerOptions: {
										scopeId: hasScoped ? scopeId : undefined,
									},
								},
							});
							// 用于存放代码，最后 join('\n') 合并成一份完整代码
							const codeList = [];

							// 保存url并且拼接参数
							const url = new URL(request.url);
							const scriptSearchParams = new URLSearchParams(url.search.slice(1));
							scriptSearchParams.append("type", "script");

							const templateSearchParams = new URLSearchParams(url.search.slice(1));
							templateSearchParams.append("type", "template");

							const path = url.pathname;

							// 使用split方法分割字符串
							const parts = path.split("/");

							// 找到"extension"这一部分的索引
							const index = parts.indexOf("extension");

							// 如果找到了"extension"，则提取它前面的所有部分并重新组合成字符串
							let subPath = "/";
							if (index !== -1) {
								subPath = parts.slice(0, index).join("/") + "/";
							}

							vueFileMap.set(
								url.origin + url.pathname + "?" + scriptSearchParams.toString(),
								// 重写 default
								sfc
									.rewriteDefault(
										script.attrs && script.attrs.lang == "ts"
											? ts.transpile(
													script.content,
													{
														module: ts.ModuleKind.ES2015,
														//@todo: ES2019 -> ES2020
														target: ts.ScriptTarget.ES2019,
														inlineSourceMap: true,
														resolveJsonModule: true,
														esModuleInterop: true,
													},
													url.origin + url.pathname + "?" + scriptSearchParams.toString()
											)
											: script.content,
										"__sfc_main__"
									)
									.replace(`const __sfc_main__`, `export const __sfc_main__`)
									// import vue重新指向
									.replaceAll(`from "vue"`, `from "${subPath}game/vue.esm-browser.js"`)
									.replaceAll(`from 'vue'`, `from '${subPath}game/vue.esm-browser.js'`)
							);

							codeList.push(`import { __sfc_main__ } from '${url.origin + url.pathname + "?" + scriptSearchParams.toString()}'`);
							codeList.push(`__sfc_main__.__scopeId = '${scopeId}'`);

							// 编译模板，转换成 render 函数
							const template = sfc.compileTemplate({
								source: descriptor.template ? descriptor.template.content : "",
								filename: request.url, // 用于错误提示
								id: scopeId,
								scoped: hasScoped,
								compilerOptions: {
									scopeId: hasScoped ? scopeId : undefined,
								},
							});

							vueFileMap.set(
								url.origin + url.pathname + "?" + templateSearchParams.toString(),
								template.code
									// .replace(`function render(_ctx, _cache) {`, str => str + 'console.log(_ctx);')
									.replaceAll(`from "vue"`, `from "${subPath}game/vue.esm-browser.js"`)
									.replaceAll(`from 'vue'`, `from '${subPath}game/vue.esm-browser.js'`)
							);

							codeList.push(`import { render } from '${url.origin + url.pathname + "?" + templateSearchParams.toString()}'`);
							codeList.push(`__sfc_main__.render = render;`);
							codeList.push(`export default __sfc_main__;`);
							// 一个 Vue 文件，可能有多个 style 标签
							let styleIndex = 0;
							for (const styleBlock of descriptor.styles) {
								const styleCode = sfc.compileStyle({
									source: styleBlock.content,
									id,
									filename: request.url,
									scoped: styleBlock.scoped,
								});
								const varName = `el${styleIndex}`;
								const styleDOM = `let ${varName} = document.createElement('style');\n${varName}.innerHTML =  \`${styleCode.code}\`;\ndocument.body.append(${varName});`;
								codeList.push(styleDOM);
							}
							js = codeList.join("\n");
							// console.log(js);
						} else if (request.url.endsWith("css")) {
							const id = Date.now().toString();
							const scopeId = `data-v-${id}`;
							js = `
								const style = document.createElement('style');
								style.setAttribute('type', 'text/css');
								style.setAttribute('data-vue-dev-id', \`${scopeId}\`);
								style.textContent = ${JSON.stringify(text)};
								document.head.appendChild(style);
							`;
						}
						const rep = new Response(new Blob([js], { type: "text/javascript" }), {
							status: 200,
							statusText: "OK",
							headers: new Headers({
								"Content-Type": "text/javascript",
							}),
						});
						console.log(request.url, "编译成功");
						return rep;
					});
				})
				.catch((e) => {
					console.error(request.url, "编译失败: ", e);
					throw e;
				})
		);
	}
});
