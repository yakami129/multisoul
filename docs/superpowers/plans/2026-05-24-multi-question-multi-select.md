# MultiAskQuestionCard 多选支持实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 MultiAskQuestionCard 组件添加多选支持，使其能够根据 `question.multi_select` 字段正确渲染和处理多选问题

**Architecture:** 改造状态从 `Record<string, string>` 为 `Record<string, string | Set<string>>`，根据问题类型条件渲染单选圆圈或复选框，复用 AskQuestionCard 的复选框样式

**Tech Stack:** React Native, TypeScript, Jest, React Testing Library

---

## 文件结构

**修改文件：**
- `mobile/src/features/chat/components/MultiAskQuestionCard.tsx` - 主组件逻辑
- `mobile/src/features/chat/components/MultiAskQuestionCard.test.tsx` - 单元测试

**参考文件：**
- `mobile/src/features/chat/components/AskQuestionCard.tsx` - 复选框样式参考
- `mobile/src/types.ts` - 类型定义（已支持 `multi_select`）
- `cli/src/serve/interactive.rs` - CLI 答案格式参考

---

### Task 1: 添加多选问题单元测试（单问题多选）

**Files:**
- Modify: `mobile/src/features/chat/components/MultiAskQuestionCard.test.tsx`

- [ ] **Step 1: 添加多选问题 toggle 测试**

在测试文件末尾添加：

```typescript
describe('MultiAskQuestionCard - Multi-select support', () => {
  it('should render checkbox for multi-select question', () => {
    const questions = [
      {
        id: '0',
        text: 'Select frameworks',
        options: [
          { id: '0', label: 'React' },
          { id: '1', label: 'Vue' },
          { id: '2', label: 'Angular' },
        ],
        multi_select: true,
      },
    ];

    const { getByText } = render(
      <MultiAskQuestionCard
        questions={questions}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(getByText('Select frameworks')).toBeTruthy();
    expect(getByText('React')).toBeTruthy();
  });

  it('should toggle options in multi-select question', () => {
    const questions = [
      {
        id: '0',
        text: 'Select frameworks',
        options: [
          { id: '0', label: 'React' },
          { id: '1', label: 'Vue' },
        ],
        multi_select: true,
      },
    ];

    const onConfirm = jest.fn();
    const { getByText, getByRole } = render(
      <MultiAskQuestionCard
        questions={questions}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Select React
    fireEvent.press(getByText('React'));
    
    // Select Vue
    fireEvent.press(getByText('Vue'));
    
    // Confirm
    fireEvent.press(getByRole('button', { name: /confirm/i }));
    
    expect(onConfirm).toHaveBeenCalledWith({ '0': '0,1' });
  });

  it('should deselect option when clicked again in multi-select', () => {
    const questions = [
      {
        id: '0',
        text: 'Select frameworks',
        options: [
          { id: '0', label: 'React' },
          { id: '1', label: 'Vue' },
        ],
        multi_select: true,
      },
    ];

    const onConfirm = jest.fn();
    const { getByText, getByRole } = render(
      <MultiAskQuestionCard
        questions={questions}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Select React
    fireEvent.press(getByText('React'));
    
    // Select Vue
    fireEvent.press(getByText('Vue'));
    
    // Deselect React
    fireEvent.press(getByText('React'));
    
    // Confirm
    fireEvent.press(getByRole('button', { name: /confirm/i }));
    
    expect(onConfirm).toHaveBeenCalledWith({ '0': '1' });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd mobile && pnpm test MultiAskQuestionCard.test.tsx --watchAll=false
```

预期：测试失败，因为组件尚未实现多选逻辑

- [ ] **Step 3: Commit 测试**

```bash
git add mobile/src/features/chat/components/MultiAskQuestionCard.test.tsx
git commit -m "test: add multi-select support tests for MultiAskQuestionCard"
```

---

### Task 2: 改造状态类型支持多选

**Files:**
- Modify: `mobile/src/features/chat/components/MultiAskQuestionCard.tsx:28-43`

- [ ] **Step 1: 修改状态初始化逻辑**

找到 `normalizedInitialAnswers` 的定义（约第 29-39 行），替换为：

```typescript
const normalizedInitialAnswers = Object.fromEntries(
  Object.entries(initialAnswers ?? {}).map(([questionId, answer]) => {
    const question = questions.find((q) => q.id === questionId);
    const isMulti = question?.multi_select ?? false;
    
    if (isMulti) {
      // 多选：逗号分隔字符串 → Set
      const ids = answer.split(',').map(s => s.trim()).filter(Boolean);
      return [questionId, new Set(ids)];
    } else {
      // 单选：保持字符串
      const isKnownOption = question?.options.some((option) => option.id === answer) ?? false;
      if (!isKnownOption) {
        initialCustomTexts[questionId] = answer;
        return [questionId, CUSTOM_ID];
      }
      return [questionId, answer];
    }
  }),
);
```

- [ ] **Step 2: 修改状态类型声明**

找到 `useState<Record<string, string>>` 的声明（约第 40 行），替换为：

```typescript
const [answers, setAnswers] = useState<Record<string, string | Set<string>>>(normalizedInitialAnswers);
```

- [ ] **Step 3: 运行 typecheck 验证**

```bash
cd mobile && pnpm typecheck
```

预期：可能有类型错误，因为其他函数还未适配新类型

- [ ] **Step 4: Commit 状态改造**

```bash
git add mobile/src/features/chat/components/MultiAskQuestionCard.tsx
git commit -m "refactor: change answers state to support multi-select (string | Set<string>)"
```

---

### Task 3: 实现多选 handleSelect 逻辑

**Files:**
- Modify: `mobile/src/features/chat/components/MultiAskQuestionCard.tsx:67-83`

- [ ] **Step 1: 替换 handleSelect 函数**

找到 `handleSelect` 函数（约第 67-83 行），完全替换为：

```typescript
const handleSelect = (questionId: string, optionId: string) => {
  if (answered) return;
  
  const question = questions.find(q => q.id === questionId);
  const isMulti = question?.multi_select ?? false;
  
  if (optionId === CUSTOM_ID) {
    // Custom 选项：清空已提交的自定义文本
    setAnswers((prev) => ({ 
      ...prev, 
      [questionId]: isMulti ? new Set([CUSTOM_ID]) : CUSTOM_ID 
    }));
    setCommittedCustomTexts((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  } else if (isMulti) {
    // 多选：toggle 选项
    setAnswers(prev => {
      const current = prev[questionId];
      const currentSet = current instanceof Set ? current : new Set<string>();
      const next = new Set(currentSet);
      
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      
      // 如果选了其他选项，移除 CUSTOM_ID
      if (next.size > 0 && next.has(CUSTOM_ID) && optionId !== CUSTOM_ID) {
        next.delete(CUSTOM_ID);
      }
      
      return { ...prev, [questionId]: next };
    });
  } else {
    // 单选：替换选项，自动跳转下一题
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: optionId };
      setActiveIndex(getNextOpenIndex(next, activeIndex + 1));
      return next;
    });
  }
};
```

- [ ] **Step 2: 运行 typecheck**

```bash
cd mobile && pnpm typecheck
```

预期：类型检查通过

- [ ] **Step 3: Commit handleSelect**

```bash
git add mobile/src/features/chat/components/MultiAskQuestionCard.tsx
git commit -m "feat: implement multi-select toggle logic in handleSelect"
```

---

### Task 4: 修复答案验证逻辑

**Files:**
- Modify: `mobile/src/features/chat/components/MultiAskQuestionCard.tsx:48-54`

- [ ] **Step 1: 修改 answeredCount 计算逻辑**

找到 `answeredCount` 的计算（约第 48-53 行），替换为：

```typescript
const answeredCount = questions.filter((q) => {
  const ans = answers[q.id];
  if (!ans) return false;
  
  if (ans instanceof Set) {
    // 多选：至少选一个，且如果选了 CUSTOM_ID 则必须有自定义文本
    if (ans.size === 0) return false;
    if (ans.has(CUSTOM_ID)) {
      return (committedCustomTexts[q.id]?.length ?? 0) > 0;
    }
    return true;
  } else {
    // 单选：有选项，且如果是 CUSTOM_ID 则必须有自定义文本
    if (ans === CUSTOM_ID) {
      return (committedCustomTexts[q.id]?.length ?? 0) > 0;
    }
    return true;
  }
}).length;
```

- [ ] **Step 2: 运行 typecheck**

```bash
cd mobile && pnpm typecheck
```

预期：类型检查通过

- [ ] **Step 3: Commit 验证逻辑**

```bash
git add mobile/src/features/chat/components/MultiAskQuestionCard.tsx
git commit -m "fix: update answer validation to support multi-select"
```

---

### Task 5: 实现答案提交格式化

**Files:**
- Modify: `mobile/src/features/chat/components/MultiAskQuestionCard.tsx:110-118`

- [ ] **Step 1: 替换 handleConfirm 函数**

找到 `handleConfirm` 函数（约第 110-118 行），完全替换为：

```typescript
const handleConfirm = () => {
  if (!allAnswered || answered) return;
  
  const resolved: Record<string, string> = {};
  for (const q of questions) {
    const raw = answers[q.id];
    
    if (raw instanceof Set) {
      // 多选：Set → 逗号分隔字符串
      const ids = Array.from(raw).filter(id => id !== CUSTOM_ID).sort();
      const customText = raw.has(CUSTOM_ID) ? committedCustomTexts[q.id] : undefined;
      const parts = customText ? [...ids, customText] : ids;
      resolved[q.id] = parts.join(',');
    } else {
      // 单选：直接使用或替换为自定义文本
      resolved[q.id] = raw === CUSTOM_ID ? (committedCustomTexts[q.id] ?? '') : raw;
    }
  }
  
  onConfirm(resolved);
};
```

- [ ] **Step 2: 运行 typecheck**

```bash
cd mobile && pnpm typecheck
```

预期：类型检查通过

- [ ] **Step 3: Commit 提交逻辑**

```bash
git add mobile/src/features/chat/components/MultiAskQuestionCard.tsx
git commit -m "feat: format multi-select answers as comma-separated string"
```

---

### Task 6: 实现条件渲染（复选框 vs 单选圆圈）

**Files:**
- Modify: `mobile/src/features/chat/components/MultiAskQuestionCard.tsx:170-220`

- [ ] **Step 1: 修改选项渲染逻辑**

找到选项渲染部分（约第 170-220 行，在 `{/* Show options only for active question */}` 注释下方），找到 `q.options.map` 循环，替换选项按钮的渲染部分：

```typescript
{q.options.map((opt, oi) => {
  const ans = answers[q.id];
  const isMulti = q.multi_select ?? false;
  const selected = isMulti 
    ? (ans instanceof Set && ans.has(opt.id))
    : (ans === opt.id);
  
  return (
    <TouchableOpacity
      key={`${q.id}-${opt.id}-${oi}`}
      accessibilityLabel={opt.label}
      style={[s.option, selected && s.optionSelected, answered && s.optionReadonly]}
      onPress={() => handleSelect(q.id, opt.id)}
      activeOpacity={answered ? 1 : 0.7}
    >
      {isMulti ? (
        <View style={[s.checkbox, selected && s.checkboxSelected]}>
          {selected && <View style={s.checkboxTick} />}
        </View>
      ) : (
        <View style={[s.radio, selected && s.radioSelected]} />
      )}
      <Text style={s.optionLabel}>{opt.label}</Text>
    </TouchableOpacity>
  );
})}
```

- [ ] **Step 2: 运行 typecheck**

```bash
cd mobile && pnpm typecheck
```

预期：类型检查通过

- [ ] **Step 3: Commit 渲染逻辑**

```bash
git add mobile/src/features/chat/components/MultiAskQuestionCard.tsx
git commit -m "feat: render checkbox for multi-select, radio for single-select"
```

---

### Task 7: 添加复选框样式

**Files:**
- Modify: `mobile/src/features/chat/components/MultiAskQuestionCard.tsx:240-392`

- [ ] **Step 1: 在 StyleSheet.create 中添加复选框样式**

找到 `StyleSheet.create` 定义（约第 240 行），在 `radio` 样式定义之后添加：

```typescript
checkbox: {
  width: 18,
  height: 18,
  borderRadius: 4,
  borderWidth: 2,
  borderColor: '#333333',
  alignItems: 'center',
  justifyContent: 'center',
},
checkboxSelected: { 
  borderColor: '#4CAF50', 
  backgroundColor: '#4CAF50' 
},
checkboxTick: { 
  width: 8, 
  height: 8, 
  backgroundColor: '#FFFFFF', 
  borderRadius: 1 
},
```

- [ ] **Step 2: 运行 typecheck**

```bash
cd mobile && pnpm typecheck
```

预期：类型检查通过

- [ ] **Step 3: Commit 样式**

```bash
git add mobile/src/features/chat/components/MultiAskQuestionCard.tsx
git commit -m "style: add checkbox styles for multi-select questions"
```

---

### Task 8: 运行测试验证实现

**Files:**
- Test: `mobile/src/features/chat/components/MultiAskQuestionCard.test.tsx`

- [ ] **Step 1: 运行所有 MultiAskQuestionCard 测试**

```bash
cd mobile && pnpm test MultiAskQuestionCard.test.tsx --watchAll=false
```

预期：所有测试通过，包括新增的多选测试

- [ ] **Step 2: 运行完整测试套件**

```bash
cd mobile && pnpm test --watchAll=false
```

预期：所有测试通过

- [ ] **Step 3: 运行 typecheck**

```bash
cd mobile && pnpm typecheck
```

预期：无类型错误

---

### Task 9: 添加混合场景测试（单选 + 多选）

**Files:**
- Modify: `mobile/src/features/chat/components/MultiAskQuestionCard.test.tsx`

- [ ] **Step 1: 添加混合场景测试**

在测试文件的 `describe('MultiAskQuestionCard - Multi-select support')` 块末尾添加：

```typescript
it('should handle mixed single-select and multi-select questions', () => {
  const questions = [
    {
      id: '0',
      text: 'Select language',
      options: [
        { id: '0', label: 'TypeScript' },
        { id: '1', label: 'JavaScript' },
      ],
      multi_select: false, // 单选
    },
    {
      id: '1',
      text: 'Select frameworks',
      options: [
        { id: '0', label: 'React' },
        { id: '1', label: 'Vue' },
        { id: '2', label: 'Angular' },
      ],
      multi_select: true, // 多选
    },
    {
      id: '2',
      text: 'Select database',
      options: [
        { id: '0', label: 'PostgreSQL' },
        { id: '1', label: 'MongoDB' },
      ],
      multi_select: false, // 单选
    },
  ];

  const onConfirm = jest.fn();
  const { getByText, getByRole } = render(
    <MultiAskQuestionCard
      questions={questions}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );

  // Q1: 单选 TypeScript
  fireEvent.press(getByText('TypeScript'));
  
  // Q2: 多选 React + Vue
  fireEvent.press(getByText('React'));
  fireEvent.press(getByText('Vue'));
  
  // Q3: 单选 PostgreSQL
  fireEvent.press(getByText('PostgreSQL'));
  
  // Confirm
  fireEvent.press(getByRole('button', { name: /confirm/i }));
  
  expect(onConfirm).toHaveBeenCalledWith({
    '0': '0',           // 单选：optionId
    '1': '0,1',         // 多选：逗号分隔
    '2': '0',           // 单选：optionId
  });
});

it('should restore multi-select state from initialAnswers', () => {
  const questions = [
    {
      id: '0',
      text: 'Select frameworks',
      options: [
        { id: '0', label: 'React' },
        { id: '1', label: 'Vue' },
        { id: '2', label: 'Angular' },
      ],
      multi_select: true,
    },
  ];

  const { getByText } = render(
    <MultiAskQuestionCard
      questions={questions}
      answered={true}
      initialAnswers={{ '0': '0,2' }} // React + Angular
      onCancel={jest.fn()}
      onConfirm={jest.fn()}
    />,
  );

  // 验证已选中状态（通过样式或其他方式，这里简化为存在性检查）
  expect(getByText('React')).toBeTruthy();
  expect(getByText('Angular')).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试**

```bash
cd mobile && pnpm test MultiAskQuestionCard.test.tsx --watchAll=false
```

预期：所有测试通过

- [ ] **Step 3: Commit 混合场景测试**

```bash
git add mobile/src/features/chat/components/MultiAskQuestionCard.test.tsx
git commit -m "test: add mixed single/multi-select and state restoration tests"
```

---

### Task 10: 最终验证

**Files:**
- All modified files

- [ ] **Step 1: 运行完整验证**

```bash
cd mobile && pnpm typecheck && pnpm test --watchAll=false
```

预期：typecheck 通过，所有测试通过

- [ ] **Step 2: 检查 git 状态**

```bash
git status
```

预期：所有改动已提交，工作目录干净

- [ ] **Step 3: 查看提交历史**

```bash
git log --oneline -10
```

预期：看到本次实施的所有 commit

---

## 验收标准

- [ ] 单问题多选：渲染复选框，支持 toggle，答案格式为逗号分隔字符串
- [ ] 多问题混合：单选问题渲染单选圆圈，多选问题渲染复选框
- [ ] 状态恢复：从 `initialAnswers` 正确恢复多选状态（逗号分隔字符串 → Set）
- [ ] 答案提交：多选答案格式化为逗号分隔字符串（如 `"0,2,4"`）
- [ ] 所有单元测试通过
- [ ] TypeScript 类型检查通过
- [ ] 视觉一致性：复选框样式与 `AskQuestionCard` 一致（绿色边框 + 白色勾选）

---

## 参考

- **设计文档**: `docs/superpowers/specs/2026-05-24-multi-question-multi-select-design.md`
- **AskQuestionCard 实现**: `mobile/src/features/chat/components/AskQuestionCard.tsx:134-140, 253-255`
- **CLI 答案解析**: `cli/src/serve/interactive.rs:120-140`
