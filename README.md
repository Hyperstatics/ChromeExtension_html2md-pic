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