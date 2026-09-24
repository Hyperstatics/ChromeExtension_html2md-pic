# 网页转 Markdown Chrome 插件

将网页文章内容一键转换为 Markdown 文档并保存到本地。

## 功能特性

- 📝 自动提取文章正文（排除导航、广告等无关内容）
- 🔄 HTML 自动转换为 Markdown 格式
- 💾 保存 Markdown 文件到用户指定目录
- 🖼️ 支持图片批量下载（第二阶段）
- 🎯 使用 Readability.js 智能识别文章内容

## 文件结构

```
├── manifest.json          # 插件配置文件
├── popup/                 # 弹出界面
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/               # 内容脚本
│   └── content.js
├── background/            # 后台脚本
│   └── background.js
├── lib/                   # 第三方库
│   ├── readability.js     # Mozilla Readability
│   └── turndown.js        # HTML 转 Markdown
└── assets/icons/          # 图标资源
```

## 安装步骤

1. 打开 Chrome 浏览器，进入 `chrome://extensions/`
2. 开启右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择本项目文件夹
5. 扩展安装成功，工具栏会出现插件图标

## 使用方法

1. 打开任意网页文章
2. 点击工具栏的插件图标
3. 选择保存目录
4. 点击"提取文章内容"按钮
5. 确认文章信息无误后，点击"保存为 Markdown"
6. 文件将保存到指定目录

## 开发计划

### 第一阶段（已完成）
- ✅ 基础插件结构
- ✅ 文章正文提取
- ✅ Markdown 转换
- ✅ 文件保存功能

### 第二阶段（待开发）
- 🔄 图片批量下载
- 🔄 图片路径替换
- 🔄 完整打包保存

## 技术栈

- Chrome Extensions Manifest V3
- Readability.js (Mozilla) - 文章提取
- Turndown - HTML 转 Markdown
- Chrome Downloads API - 文件下载

## 许可证

MIT License

## 下载流程与验证

保存时，弹窗一次性将 Markdown 和所选图片交给后台。后台先提交 Markdown，随后提交图片，不等待单个文件下载完成；关闭弹窗不会中断已经交给后台的流程。界面提示“下载已提交”后，可在 Chrome 下载记录中查看文件的最终状态。

修改代码后，在 `chrome://extensions/` 点击本插件的重新加载按钮，再打开插件使用。

运行下载回归测试：

```sh
node --test tests/downloads.test.cjs
```

测试覆盖后台完整任务提交、慢下载不阻塞后续文件、单张图片启动失败、Markdown 单独导出、文件扩展名与链接一致，以及弹窗重复点击保护。测试模拟 Chrome API，不替代真实浏览器扩展验证。
