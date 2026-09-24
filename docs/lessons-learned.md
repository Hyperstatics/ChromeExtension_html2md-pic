# Chrome 插件开发经验教训

## 本次修复的问题总结

### 1. chrome.downloads API 在 saveAs 模式下的行为

**问题现象**：点击"选择目录"按钮后，目录没有被正确保存

**根本原因**：
- 使用 `chrome.downloads.onCreated` 监听下载创建事件
- 在 `saveAs: true` 模式下，`onCreated` 事件触发时 `filename` 是**空字符串**
- 只有当用户完成目录选择后，`filename` 才会被填充

**正确做法**：
```javascript
// ❌ 错误：onCreated 事件中 filename 为空
chrome.downloads.onCreated.addListener((item) => {
  console.log(item.filename); // ""
});

// ✅ 正确：使用 onChanged 监听 filename 变化
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.filename && delta.filename.current) {
    const fullPath = delta.filename.current; // "/Users/xxx/Downloads/file.txt"
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
  }
});
```

---

### 2. 路径分隔符兼容性

**问题现象**：Windows 上无法正确提取目录路径

**根本原因**：Windows 使用 `\` 作为路径分隔符，而代码只处理了 `/`

**正确做法**：
```javascript
// 处理 Windows 和 Unix 路径分隔符
let lastSlashIndex = fullPath.lastIndexOf('/');
let lastBackslashIndex = fullPath.lastIndexOf('\\');
let separatorIndex = Math.max(lastSlashIndex, lastBackslashIndex);
const dirPath = fullPath.substring(0, separatorIndex);
```

---

### 3. Service Worker 中不能使用 URL.createObjectURL

**问题现象**：保存文件时报错 `URL.createObjectURL is not a function`

**根本原因**：Service Worker (Manifest V3) 不支持 `URL.createObjectURL`

**正确做法**：使用 base64 Data URL
```javascript
// ❌ 错误：Service Worker 中不支持
const blob = new Blob([content], { type: 'text/markdown' });
const url = URL.createObjectURL(blob);

// ✅ 正确：使用 base64 Data URL
const base64 = btoa(unescape(encodeURIComponent(content)));
const dataUrl = 'data:text/markdown;charset=utf-8;base64,' + base64;

await chrome.downloads.download({
  url: dataUrl,
  filename: fileName,
  saveAs: false
});
```

---

### 4. async 函数返回值问题

**问题现象**：保存的文件内容为 `undefined`

**根本原因**：消息监听器的回调函数没有正确处理 async 函数的返回值

**正确做法**：
```javascript
// ❌ 错误：async 函数但没有正确返回 Promise
async function extractArticle() {
  // ...
  return data; // 这返回的是 Promise，但消息处理器没有 await
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const result = extractArticle(); // result 是 Promise，不是数据
  sendResponse({ success: true, data: result });
});

// ✅ 正确：改为同步函数
function extractArticle() {
  // ...
  return data; // 直接返回数据
}
```

---

## 调试技巧

### 查看 popup 的 Console
Chrome 插件的 popup 有独立的开发者工具：
1. 右键点击 popup 页面
2. 选择"检查"或按 F12
3. 或者在 Console 顶部的下拉菜单中选择 popup.html

### 添加调试日志
在关键位置添加日志帮助定位问题：
```javascript
console.log('[选择目录] 完整路径:', fullPath);
console.log('[选择目录] 提取目录:', dirPath);
```

---

### 5. 图标制作的最佳实践

**问题现象**：使用 SVG 转 PNG 时容易出现死循环、内存溢出等问题

**根本原因**：
- SVG 转 PNG 需要复杂的渲染流程
- 在自动化工具中处理容易出现无限递归
- 不同尺寸的图标需要分别处理

**正确做法**：
```
第一阶段（快速验证）：
- 使用 Emoji 或文字作为临时图标
- 例如：📄、📝、MD 等
- 先完成功能开发，不纠结图标

第二阶段（专业设计）：
- 功能稳定后再制作正式图标
- 使用专业设计工具（Figma、Illustrator）
- 导出 16x16、32x32、48x48、128x128 等尺寸
- 或者提醒用户另外处理图标
```

**示例代码**：
```json
// manifest.json - 第一阶段使用临时图标
{
  "icons": {
    "16": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📝</text></svg>",
    "48": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📝</text></svg>",
    "128": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📝</text></svg>"
  }
}
```

---

### 6. 图片下载与 Markdown 路径替换

**实现要点**：

1. **保持扩展名一致**：从原始 URL 中提取图片扩展名，保持下载后的文件格式不变
```javascript
const extMatch = pathname.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
if (extMatch && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(foundExt)) {
  ext = '.' + foundExt;
}
```

2. **正则替换时的 URL 转义**：Markdown 中的图片 URL 包含特殊字符，需要转义后再用于正则匹配
```javascript
const escapedUrl = image.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regex = new RegExp(`!\\[(.*?)\\]\\(${escapedUrl}\\)`, 'g');
```

3. **由后台提交完整下载任务**：popup 只发送一次 `saveArticle` 消息。后台先提交 Markdown 下载，再逐一提交图片下载；`chrome.downloads.download()` 返回 ID 仅代表下载已启动，不代表文件已保存完成。不要在 popup 中等待第一阶段结束后再发送第二阶段消息，弹窗关闭会使后续代码无法执行。也不要逐张等待 `onChanged` 完成事件后才启动下一张，慢下载会阻塞整个批次。实际完成、取消或失败状态在 Chrome 下载记录中查看。

4. **文件组织方式**：
```
用户选择目录/
├── 文章标题.md
└── 文章标题_images/
    ├── image-001.jpg
    ├── image-002.png
    └── ...
```

---

## 参考文档

- [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/downloads/)
- [Chrome Service Worker](https://developer.chrome.com/docs/extensions/mv3/service_workers/)
