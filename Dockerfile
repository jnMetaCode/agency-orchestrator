# Agency Orchestrator — Docker/NAS 部署镜像（#93）
# 安装 npm 已发布版本（与 npm 渠道同源），数据全部落在 /data 卷：
#   - 密钥（页面「供应商」里配置）→ /data/.local/web-keys.json
#   - 运行产物 → /data/ao-output    - 自组工作流 → /data/ao-workflows
#
#   docker build -t agency-orchestrator .                    # 默认装 latest
#   docker build --build-arg AO_VERSION=0.11.0 -t ... .      # 锁定版本
FROM node:22-slim

ARG AO_VERSION=latest
RUN npm i -g agency-orchestrator@${AO_VERSION} && npm cache clean --force

# 容器内必须绑 0.0.0.0 才能被宿主/局域网访问；数据目录指向挂载卷
ENV HOST=0.0.0.0 \
    PORT=8088 \
    AO_DATA_DIR=/data

VOLUME /data
EXPOSE 8088

# slim 镜像无 curl，用 node 自带 fetch 做健康检查。
# 设了 AO_WEB_TOKEN 时 /api/health 也要令牌（这是有意的：前端靠这个 401 才知道要提示"需要访问令牌"，
# 而不是显示成"没装引擎"），所以这里把容器里的令牌带上——不带的话整个容器会被判 unhealthy。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const t=process.env.AO_WEB_TOKEN;fetch('http://127.0.0.1:8088/api/health',t?{headers:{Authorization:'Bearer '+t}}:undefined).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["ao", "web"]
