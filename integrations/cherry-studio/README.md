# Cherry Studio 集成

Cherry Studio 没有命令行，AO 不给它做连接器。但它的 **API 网关**能把你在 Cherry 里配好的所有模型服务
转成本机的 OpenAI / Anthropic 兼容 HTTP 接口——AO 直接把它当一个 OpenAI 兼容供应商用，
**Cherry 里配过的 key 一个都不用再填**。

## 步骤

1. Cherry Studio：设置 → **API 网关** → 启动。界面会显示可用 URL 和 API 密钥（密钥按网关实例生成，可重置）。
2. 拿模型 id（网关的模型名以它返回的为准，不要猜）：

   ```bash
   curl <网关 URL>/v1/models -H "Authorization: Bearer <API 密钥>"
   ```

3. 工作流里当 OpenAI 兼容端点接入：

   ```yaml
   llm:
     provider: "cherry-studio"          # 任意名字；带 base_url 即按 OpenAI 兼容处理
     base_url: "<网关 URL>/v1"           # 以第 1 步界面显示的为准
     api_key: "<API 密钥>"               # 或环境变量 OPENAI_API_KEY
     model: "<第 2 步拿到的模型 id>"
   ```

   Studio 里则在「设置 → 供应商 → 自定义」填同样三项。

## 事实来源

- 以上来自 Cherry Studio 官方文档「API 网关」页（docs.cherryai.com.cn/advanced-basic/developer-tools/api-gateway）：
  OpenAI 与 Anthropic 兼容、`Authorization: Bearer <密钥>`、默认只监听本机、需要至少配好一个模型服务商。
- 文档**没有**写死默认端口和模型命名规则，所以这里也不写——以你界面上显示的为准。
- 本机没装 Cherry Studio，这条链路**没有真机跑过**；端口/密钥/模型 id 请按上面三步实测。

## 注意

- 密钥泄露先停网关再重置；别把它写进仓库。
- 网关默认只在本机可达，AO 跑在同一台机器上即可。
- Cherry 的「智能体」是应用内数据，没有目录可装，`ao install` 不支持它。
