import { loadMermaidSource } from './mermaidAsset';

const mockDownloadAsync = jest.fn().mockResolvedValue(undefined);
const mockText = jest.fn().mockResolvedValue('globalThis["mermaid"] = {}');
const mockFile = jest.fn();

jest.mock('../../../../assets/mermaid.min.html', () => 123, { virtual: true });

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    constructor(uri: string) {
      mockFile(uri);
    }

    text() {
      return mockText();
    }
  },
}));

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: jest.fn(() => ({
      localUri: 'file://mermaid.min.html',
      uri: 'asset://mermaid.min.html',
      downloadAsync: mockDownloadAsync,
    })),
  },
}));

describe('loadMermaidSource', () => {
  beforeEach(() => {
    jest.resetModules();
    mockDownloadAsync.mockClear();
    mockText.mockClear();
    mockFile.mockClear();
  });

  /// Mermaid 静态资产加载：必须用 FileSystem 读取下载后的本地资产，不能依赖 fetch(file://...)
  ///
  /// 数据构造：
  ///   Asset.fromModule mock 返回 localUri='file://mermaid.min.html'
  ///   File mock 接收该 localUri，file.text() 返回 'globalThis["mermaid"] = {}'
  ///   mermaid.min.html mock 模块 id = 123（模拟 Metro 静态资产编号）
  ///
  /// 执行过程：
  ///   1. import loadMermaidSource
  ///   2. 调用 loadMermaidSource() 两次
  ///   3. 第一次通过 Asset.downloadAsync + File(localUri).text() 读取文本
  ///   4. 第二次命中模块级缓存，不再重复读取 3.3MB 资产
  ///
  /// 预期结果：
  ///   - 正断言：返回字符串包含 Mermaid 源码片段
  ///   - 正断言：FileSystem 使用静态资产 localUri
  ///   - 负断言：第二次调用不再重复读取，说明缓存生效
  it('loads mermaid source from a static asset file and caches it', async () => {
    const first = await loadMermaidSource();
    const second = await loadMermaidSource();

    // 断言失败 = loader 返回的不是 Mermaid 源码文本，可能仍在把 bundle 当 JS 模块执行
    expect(first).toContain('globalThis["mermaid"]');
    // 断言失败 = 第二次调用没有复用缓存，会重复读取 3.3MB 静态资产
    expect(second).toBe(first);
    // 断言失败 = loader 没有用 FileSystem 读取下载后的静态资产 localUri
    expect(mockFile).toHaveBeenCalledWith('file://mermaid.min.html');
    // 断言失败 = 第二次调用仍读取文件，缓存未生效
    expect(mockText).toHaveBeenCalledTimes(1);
  });
});
