# UI 常见设计问题清单

开发任何 UI 页面前，必须逐条检查本清单。

---

## 1. RefreshControl 与数据请求状态耦合

**错误写法：**
```tsx
const { refetch, isFetching } = useQuery({ ... });

<FlatList
  refreshControl={
    <RefreshControl refreshing={isFetching} onRefresh={refetch} />
  }
/>
```

**问题：** `isFetching` 在任何后台请求（轮询、focus 触发的静默刷新）时都为 `true`，导致下拉动画在用户没有手动下拉时自动弹出，体验诡异。

**正确写法：**
```tsx
const { refetch } = useQuery({ ... });
const [refreshing, setRefreshing] = useState(false);

const handleRefresh = useCallback(async () => {
  setRefreshing(true);
  try {
    await refetch();
  } finally {
    setRefreshing(false);
  }
}, [refetch]);

<FlatList
  refreshControl={
    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
  }
/>
```

**规则：** `refreshing` 必须是独立的本地 state，只在用户手动下拉时置为 `true`，与后台请求状态完全解耦。

---

## 2. useFocusEffect 触发的刷新不应驱动 RefreshControl

**错误写法：**
```tsx
useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

// 同时把 isFetching 传给 RefreshControl
<RefreshControl refreshing={isFetching} ... />
```

**问题：** 每次切换 tab 都会触发 `isFetching=true`，RefreshControl 动画随之弹出。

**规则：** focus 刷新是静默行为，不应有任何可见的 loading 动画。只有用户主动下拉才显示 spinner。

---

## 3. FlatList 空列表时 RefreshControl 失效

**注意：** 当列表为空时，通常渲染 `ListEmptyComponent` 而非 `FlatList`，此时下拉刷新不可用。

**正确做法：** 空列表状态也应保留 `FlatList`（`data={[]}`），不要用条件渲染替换整个组件，否则用户无法下拉刷新来重新加载数据。

---

## 4. 颜色规范

- `RefreshControl` 必须使用 `tintColor="#20C20E"`，保持 PIP-BOY 主题一致性。
- 禁止使用系统默认的白色/灰色 spinner。

---

## 5. Pressable 动态样式的 TypeScript 类型问题

**错误写法：**
```tsx
<Pressable
  style={({ pressed }) => [
    s.chip,
    isSelected && s.chipSelected,
    pressed && s.chipPressed,
  ]}
>
```

**问题：** TypeScript 无法正确推断样式数组的类型，导致类型错误：
```
Argument of type '{ backgroundColor: string; }' is not assignable to parameter of type '{ height: number; ... }'.
```

**正确写法 1（推荐）：**
```tsx
<Pressable
  style={({ pressed }) => {
    return [s.chip, isSelected && s.chipSelected, pressed && s.chipPressed];
  }}
>
```

**正确写法 2（更明确）：**
```tsx
<Pressable
  style={({ pressed }) => {
    const styles = [s.chip];
    if (isSelected) styles.push(s.chipSelected);
    if (pressed) styles.push(s.chipPressed);
    return styles;
  }}
>
```

**规则：**
- 使用显式 `return` 语句，帮助 TypeScript 正确推断返回类型
- 使用函数体 `{}` 包裹，而不是直接返回数组表达式
- 确保 StyleSheet 中的 `alignItems` 和 `justifyContent` 使用 `as const` 类型断言

**StyleSheet 定义：**
```tsx
const s = StyleSheet.create({
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#1A1A1A',
    alignItems: 'center' as const,  // 必须使用 as const
    justifyContent: 'center' as const,
  },
});
```

---

## 参考

- 设计系统：`mobile/docs/design.md`
- 设计规范检查清单：`mobile/docs/design.md §11`
