# GitHub 与 Chrome Web Store 发布配置

完成一次配置后，发布链路为：推送版本 Tag → GitHub Release → 自动上传 Chrome Web Store → 审核通过后 Chrome/Arc 自动更新。

## 1. 首次上架

1. 注册 Chrome Web Store 开发者账号并开启两步验证。
2. 本地运行 `npm run package`，得到 `dist/ux-viewport.zip`。
3. 在 Developer Dashboard 创建扩展并上传 ZIP。
4. 按 `store-listing/zh-CN.md` 填写商店资料和隐私声明，上传截图与宣传图。
5. Distribution 选择 `Unlisted`，首次手动提交并发布一次。
6. 保存 Publisher ID、Extension ID 和商店安装链接。

首次发布后，把商店链接发给同事安装。后续版本会由浏览器自动更新，也可在 `chrome://extensions/` 打开开发者模式后点击「更新」立即检查。

## 2. 创建发布身份

1. 在 Google Cloud 创建项目并启用 Chrome Web Store API。
2. 创建服务账号，例如 `ux-viewport-publisher`，无需授予项目角色。
3. 在 Chrome Web Store Developer Dashboard 的 Account 页面添加该服务账号邮箱。
4. 为 GitHub Actions 配置 Workload Identity Federation，并把授权范围限制到当前 GitHub 仓库。

下面的变量名均为示例，替换成实际值：

```bash
export CWS_GCP_PROJECT="your-google-cloud-project-id"
export CWS_GITHUB_REPO="owner/ux-viewport"
export CWS_SERVICE_ACCOUNT="ux-viewport-publisher@${CWS_GCP_PROJECT}.iam.gserviceaccount.com"

gcloud services enable chromewebstore.googleapis.com \
  --project="$CWS_GCP_PROJECT"

gcloud iam workload-identity-pools create github \
  --project="$CWS_GCP_PROJECT" \
  --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc ux-viewport \
  --project="$CWS_GCP_PROJECT" \
  --location=global \
  --workload-identity-pool=github \
  --display-name="UX Viewport GitHub Actions" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '${CWS_GITHUB_REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

export CWS_POOL_RESOURCE="$(gcloud iam workload-identity-pools describe github \
  --project="$CWS_GCP_PROJECT" \
  --location=global \
  --format='value(name)')"

gcloud iam service-accounts add-iam-policy-binding "$CWS_SERVICE_ACCOUNT" \
  --project="$CWS_GCP_PROJECT" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${CWS_POOL_RESOURCE}/attribute.repository/${CWS_GITHUB_REPO}"

gcloud iam workload-identity-pools providers describe ux-viewport \
  --project="$CWS_GCP_PROJECT" \
  --location=global \
  --workload-identity-pool=github \
  --format='value(name)'
```

如果 `github` 身份池已存在，复用它并跳过创建身份池。

## 3. 配置 GitHub Variables

在仓库 `Settings → Secrets and variables → Actions → Variables` 添加：

| Variable | 值 |
|---|---|
| `CWS_PUBLISH_ENABLED` | `true` |
| `CWS_PUBLISHER_ID` | Chrome Web Store Publisher ID |
| `CWS_EXTENSION_ID` | Chrome Web Store Extension ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | 上一步最后一条命令输出的完整 Provider 名称 |
| `GCP_SERVICE_ACCOUNT` | 服务账号邮箱 |

此方案不保存长期 Google 密钥。

## 4. 后续发布

同步修改 `manifest.json` 与 `package.json` 的版本号，然后推送同版本 Tag：

```bash
git tag v1.2.0
git push origin v1.2.0
```

GitHub Actions 会测试、打包、生成 Release，并把更新提交到 Chrome Web Store。商店审核通过后，已安装用户无需重新下载安装。
