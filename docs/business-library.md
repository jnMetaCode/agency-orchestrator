# AI 商业库

入口：`/business`、`/zh/business`、`/en/business`。官网、local 与桌面 App 共用 React 页面和发布数据，不要求浏览器连接本地后端。

首页有四张分类数量卡片，分别指向 `/business/companies`、`/business/investors`、`/business/contacts`、`/business/arr`，可直接访问和分享。数量读取数据 manifest。

当前为只读数据快照，没有增加运行时数据库。四个列表对应 companies、investors、contacts、arr 数据集；详细资料每 100 条分片，列表每页展示 30 条。仅加载当前分类的索引，点击详情再加载相应分片。机构与联系人、公司与 ARR 榜单可互相查看。

## 更新数据

```sh
python3 scripts/import-business-data.py /path/to/csv-directory
python3 scripts/check-business-data.py
npm run typecheck --prefix website
npm run build --prefix website
```

输入文件名固定为导入脚本中的四个 Lounge CSV 文件名。原始 CSV 不需要提交；生成的 `website/public/business-data/` 必须提交，Cloudflare Pages 构建不需要访问开发者的 Downloads 目录。重新构建、发布官网和 App 后才会更新对应环境。

`manifest.json` 记录输入文件 SHA-256、数据快照、各数据集数量以及未匹配 ARR 公司。后续更换数据月份时应同步修改导入脚本中的 snapshot 和页面展示日期。

## 关联和清洗

- 机构以规范化 Lounge 地址关联；联系人文件中存在但机构导出缺失的机构补建基础记录，标记 `record_origin=contacts`。
- 公司以 Lounge 地址生成稳定 ID；ARR 先按唯一名称匹配，再按唯一官网域名匹配。无法确定的匹配保留在 manifest，不进行模糊猜测。
- 机构 partner1/2/3 与现有联系人按机构、姓名去重后合并；联系人规范化 ID 冲突时合并空缺字段。当前联系人从 6,731 条合并为 6,730 条。
- 缺失金额保留为空；列表不把未知金额显示为零。ARR 保留 reported / estimate 口径、日期及来源。
- 邮箱状态沿用来源标签，并未重新验证。详细联系人资料会作为公开静态文件发布；它不属于受登录保护的私有通讯录。

## 验证边界

完整性脚本校验记录数量、ID 唯一性、索引分片一致性、机构联系人数量、联系人外键、ARR 公司关联和静态文件大小。它不验证来源数据中的财务金额或联系方式是否准确。
