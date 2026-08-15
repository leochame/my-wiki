# Java 笔试常用代码速查

## 目录
- [字符串与数字转换](#字符串与数字转换)
- [排序函数控制](#排序函数控制)
- [常用 API 速查](#常用-api-速查)
- [笔试高频算法模板](#笔试高频算法模板)

---

## 字符串与数字转换

### 基础转换
```java
// 字符串转数字
String s = "123";
int n = Integer.parseInt(s);           // 123
long l = Long.parseLong("123456789");  // 123456789L
double d = Double.parseDouble("3.14"); // 3.14

// 数字转字符串
int n = 123;
String s = String.valueOf(n);   // "123"
String s = Integer.toString(n); // "123"
String s = n + "";              // "123" (简单但略慢)
```

### 进制转换
```java
// 十进制转其他进制
int n = 255;
Integer.toBinaryString(n)  // "11111111"
Integer.toOctalString(n)   // "377"
Integer.toHexString(n)     // "ff" (小写)

// 其他进制转十进制
Integer.parseInt("1111", 2)  // 15
Integer.parseInt("ff", 16)   // 255
Integer.parseInt("FF", 16)   // 255 (大小写都行)
Integer.parseInt("77", 8)    // 63
Long.parseLong("ffffffff", 16) // 4294967295L

// 指定进制转指定进制
String hex = Integer.toHexString(Integer.parseInt("1111", 2)); // "f"
```

### 格式化输出
```java
String.format("%04d", 255)     // "0255" 补零
String.format("%,d", 1234567)  // "1,234,567" 千分位
String.format("%.2f", 3.14159) // "3.14" 保留两位
String.format("%x", 255)       // "ff" 十六进制
String.format("%X", 255)       // "FF" 大写
String.format("%o", 255)       // "377" 八进制

// DecimalFormat 更灵活
import java.text.DecimalFormat;
new DecimalFormat("0000").format(255)    // "0255"
new DecimalFormat("#.##").format(3.14159) // "3.14"
new DecimalFormat("#,###").format(1234567) // "1,234,567"
```

### 字符与 ASCII 码
```java
(char) 65       // 'A'
(int) 'A'       // 65
Character.isDigit('5')    // true
Character.isLetter('a')   // true
Character.isUpperCase('A') // true
Character.toLowerCase('A') // 'a'
Character.toUpperCase('a') // 'A'

// 字符数字互转
char c = '5';
int n = c - '0';           // 5
char c2 = (char) (n + '0'); // '5'
Character.getNumericValue('5') // 5 (处理 Unicode 数字)
```

### 特殊情况处理

#### 1. 溢出问题
```java
// parseInt 溢出会抛 NumberFormatException
Integer.parseInt("2147483648"); // 抛异常，超过 Integer.MAX_VALUE

// 安全做法：用 long 接收，再判断范围
String s = "2147483648";
long val = Long.parseLong(s);
if (val > Integer.MAX_VALUE || val < Integer.MIN_VALUE) {
    // 溢出处理
}

// 或用 BigInteger
BigInteger big = new BigInteger("99999999999999999999");

// 笔试场景：字符串转整数（处理溢出）
int myAtoi(String s) {
    s = s.trim();
    if (s.isEmpty()) return 0;

    int sign = 1, i = 0;
    if (s.charAt(0) == '-' || s.charAt(0) == '+') {
        sign = s.charAt(0) == '-' ? -1 : 1;
        i = 1;
    }

    int result = 0;
    while (i < s.length() && Character.isDigit(s.charAt(i))) {
        int digit = s.charAt(i) - '0';
        // 溢出检查：在乘 10 之前检查
        if (result > (Integer.MAX_VALUE - digit) / 10) {
            return sign == 1 ? Integer.MAX_VALUE : Integer.MIN_VALUE;
        }
        result = result * 10 + digit;
        i++;
    }
    return result * sign;
}
```

#### 2. 空字符串与 null
```java
// 空字符串
Integer.parseInt("")    // NumberFormatException
Integer.parseInt("   ") // NumberFormatException (空格也不行)

// null
Integer.parseInt(null)  // NumberFormatException

// 安全转换方法
Integer safeParseInt(String s) {
    if (s == null || s.trim().isEmpty()) return null;
    try {
        return Integer.parseInt(s.trim());
    } catch (NumberFormatException e) {
        return null;
    }
}

// 或用 Apache Commons Lang (笔试一般没有)
// NumberUtils.toInt("123", 0) // 默认值 0
// NumberUtils.isCreatable("123") // true
```

#### 3. 前导零与正负号
```java
// 前导零自动忽略
Integer.parseInt("00123")  // 123

// 正负号
Integer.parseInt("+123")   // 123
Integer.parseInt("-123")   // -123
Integer.parseInt("--123")  // NumberFormatException

// 八进制前缀 0 不会被自动识别
Integer.parseInt("0123")   // 123 (不是八进制！)
Integer.parseInt("0123", 8) // 83 (显式指定八进制)

// 十六进制前缀 0x 需要手动处理
Integer.parseInt("0xff", 16)  // 255 (不识别 0x，会报错)
Integer.parseInt("0xff".substring(2), 16) // 255 (正确方式)
Integer.decode("0xff")     // 255 (decode 支持 0x/0/# 前缀)
```

#### 4. 小数精度问题
```java
// float/double 有精度问题
double d = 0.1 + 0.2;      // 0.30000000000000004
String.valueOf(d)          // "0.30000000000000004"

// 用 BigDecimal 处理精确计算
import java.math.BigDecimal;
BigDecimal bd1 = new BigDecimal("0.1");  // 用字符串构造！
BigDecimal bd2 = new BigDecimal("0.2");
BigDecimal sum = bd1.add(bd2);           // 0.3 精确

// double 构造有问题
new BigDecimal(0.1)        // 0.100000000000000005551115...
new BigDecimal("0.1")      // 0.1 精确

// 小数转字符串
double d = 3.14;
String s = String.valueOf(d);     // "3.14"
String s = Double.toString(d);    // "3.14"

// 去掉多余的零
new BigDecimal("3.1400").stripTrailingZeros().toString() // "3.14"
// 注意：0.00 会变成 "0E+1"，需要 toPlainString()
new BigDecimal("0.00").stripTrailingZeros().toPlainString() // "0"

// 保留小数位
new BigDecimal("3.14159").setScale(2, RoundingMode.HALF_UP).toString() // "3.14"
```

#### 5. 科学计数法
```java
Double.parseDouble("1.5e10")   // 1.5E10
Double.parseDouble("1.5E-3")   // 0.0015
Double.parseDouble("3e8")      // 3.0E8

// 输出科学计数法
String.format("%e", 1500000000.0)  // "1.500000e+09"

// 科学计数法转普通字符串
double d = 1.5e10;
BigDecimal bd = new BigDecimal(d);
bd.toPlainString()            // "15000000000"
```

#### 6. BigInteger 和 BigDecimal
```java
// 大整数
BigInteger bi = new BigInteger("99999999999999999999");
bi.add(BigInteger.ONE);
bi.subtract(BigInteger.TEN);
bi.multiply(BigInteger.valueOf(2));
bi.divide(BigInteger.valueOf(3));
bi.mod(BigInteger.valueOf(100));

// 比较
bi.compareTo(BigInteger.ZERO)  // >0 正数, =0 零, <0 负数
bi.equals(BigInteger.ZERO)     // 值相等

// 大小数
BigDecimal bd = new BigDecimal("123.456");
bd.setScale(2, RoundingMode.HALF_UP);  // 保留2位，四舍五入

// 类型转换
bi.intValue()     // 可能丢失精度
bi.longValue()
bd.doubleValue()
bd.intValue()
```

#### 7. 字符串清理后转换
```java
// 去掉非数字字符
String s = "a1b2c3";
String digits = s.replaceAll("[^0-9-]", ""); // "123" 或 "-123"

// 去掉空格和逗号
String s = "  1, 234, 567  ";
s = s.replaceAll("[,\\s]", ""); // "1234567"
int n = Integer.parseInt(s);

// 提取第一个数字
String s = "price: 123.45 yuan";
String num = s.replaceAll(".*?(-?\\d+\\.?\\d*).*", "$1"); // "123.45"

// 用正则提取所有数字
Pattern p = Pattern.compile("-?\\d+");
Matcher m = p.matcher("a1b-23c456");
while (m.find()) {
    System.out.println(m.group()); // 1, -23, 456
}
```

#### 8. 数组与字符串互转
```java
// int[] -> String
int[] nums = {1, 2, 3};
// 方法1：StringBuilder
StringBuilder sb = new StringBuilder();
for (int num : nums) sb.append(num);
String s = sb.toString(); // "123"

// 方法2：Arrays.toString (带括号逗号)
Arrays.toString(nums) // "[1, 2, 3]"

// 方法3：String.join + stream
String.join(",", Arrays.stream(nums).mapToObj(String::valueOf).toArray(String[]::new))
// "1,2,3"

// String -> int[]
String s = "123";
int[] nums = new int[s.length()];
for (int i = 0; i < s.length(); i++) {
    nums[i] = s.charAt(i) - '0';
}

// String "1,2,3" -> int[]
String s = "1,2,3";
int[] nums = Arrays.stream(s.split(","))
                   .mapToInt(Integer::parseInt)
                   .toArray();

// char[] <-> String
char[] chars = "hello".toCharArray();
String s = new String(chars);
String s = String.valueOf(chars);
```

---

## 排序函数控制

```java
// 基本数组排序
int[] arr = {3, 1, 4, 1, 5};
Arrays.sort(arr);  // 原地升序: [1, 1, 3, 4, 5]

// 降序 — 只能对包装类型
Integer[] arr = {3, 1, 4, 1, 5};
Arrays.sort(arr, Collections.reverseOrder()); // [5, 4, 3, 1, 1]

// 对部分排序
Arrays.sort(arr, 0, 3); // 只排 [0, 3)

// 自定义排序 — 对象数组
int[][] pairs = {{1, 3}, {2, 2}, {3, 1}};
// 按第二个元素升序
Arrays.sort(pairs, (a, b) -> a[1] - b[1]);
// 按第一个元素降序
Arrays.sort(pairs, (a, b) -> b[0] - a[0]);
// 多条件：先按第二元素升序，再按第一元素降序
Arrays.sort(pairs, (a, b) -> {
    if (a[1] != b[1]) return a[1] - b[1];
    return b[0] - a[0];
});

// 自定义排序 — List
List<int[]> list = new ArrayList<>();
list.sort((a, b) -> a[0] - b[0]);

// 对自定义类排序
class Student {
    String name;
    int score;
    Student(String name, int score) {
        this.name = name;
        this.score = score;
    }
}
List<Student> students = new ArrayList<>();
students.add(new Student("Alice", 85));
students.add(new Student("Bob", 90));

// Lambda
students.sort((a, b) -> b.score - a.score); // 分数降序

// Comparator 链式
students.sort(Comparator
    .comparingInt((Student s) -> s.score).reversed()
    .thenComparing(s -> s.name));

// 实现 Comparable
class Student implements Comparable<Student> {
    String name;
    int score;
    public int compareTo(Student o) {
        return this.score - o.score; // 升序
    }
}
Collections.sort(students); // 自动用 compareTo
```

**排序注意事项：**
```java
// 溢出陷阱！比较器用减法可能溢出
// 错误：
Arrays.sort(arr, (a, b) -> a[0] - b[0]); // a=-20亿, b=20亿 时溢出
// 正确：
Arrays.sort(arr, (a, b) -> Integer.compare(a[0], b[0]));

// int[] 不能直接降序，必须转 Integer[] 或手动翻转
int[] arr = {3, 1, 4, 1, 5};
Arrays.sort(arr);
// 手动翻转
for (int i = 0, j = arr.length - 1; i < j; i++, j--) {
    int tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
}
```

---

## 常用 API 速查

### Math
```java
Math.abs(-5)          // 5
Math.max(1, 2)        // 2
Math.min(1, 2)        // 1
Math.pow(2, 3)        // 8.0
Math.sqrt(16)         // 4.0
Math.floor(3.7)       // 3.0  向下取整
Math.ceil(3.2)        // 4.0  向上取整
Math.round(3.5)       // 4    四舍五入
Math.random()         // [0.0, 1.0)
```

### String
```java
String s = "hello world";
s.length()                    // 11
s.charAt(0)                   // 'h'
s.substring(0, 5)             // "hello" [0, 5)
s.substring(6)                // "world" 从6到末尾
s.trim()                      // 去两端空白
s.toUpperCase() / s.toLowerCase()
s.replace('l', 'L')           // "heLLo worLd"
s.replace("hello", "hi")      // "hi world"
s.indexOf("world")            // 6 (不存在返回 -1)
s.lastIndexOf("l")            // 9
s.startsWith("he")            // true
s.endsWith("d")               // true
s.contains("lo")              // true
s.isEmpty()                    // s.length() == 0

// 分割
String[] parts = "a,b,c".split(","); // ["a", "b", "c"]
// 注意：split 参数是正则，. 需要转义
"1.2.3".split("\\.");

// ===== split 陷阱与转义字符 =====

// 1. split 参数是正则，特殊字符必须转义
// 需要转义的正则元字符: . | * + ? ^ $ ( ) [ { \
"a|b|c".split("\\|");              // ["a", "b", "c"]
"a+b+c".split("\\+");              // ["a", "b", "c"]
"a.b.c".split("\\.");              // ["a", "b", "c"]
"a*b*c".split("\\*");              // ["a", "b", "c"]
"a$b$c".split("\\$");              // ["a", "b", "c"]
"a^b^c".split("\\^");              // ["a", "b", "c"]

// 2. 反斜杠 \ 的分割 — 最容易踩坑
// Java 字符串中 \\ 表示一个 \，正则中 \\\\ 表示匹配一个 \
"a\\b\\c".split("\\\\");           // ["a", "b", "c"]
// 等价理解：字符串里是 a\b\c，用 \ 作为分隔符
// Java 字符串字面量: "a\\b\\c" → 实际内容 a\b\c
// 正则 \\\\ → 匹配单个 \

// 3. 多字符分隔符 — 用 Pattern.quote() 免转义
"a|b.c*d".split(Pattern.quote("|"));   // ["a", "b.c*d"] — 安全转义
"a[0]b".split(Pattern.quote("[0]"));    // ["a", "b"] — 免去手写正则
import java.util.regex.Pattern;

// 4. 连续分隔符与尾部空串
"a,,b,,c".split(",");              // ["a", "", "b", "", "c"]
"a,,b,,c".split(",+");             // ["a", "b", "c"] — 合并连续分隔符
"a,b,c,".split(",");               // ["a", "b", "c"] — 尾部空串被丢弃！
"a,b,c,".split(",", -1);           // ["a", "b", "c", ""] — 保留尾部空串
// split(regex, limit): limit=-1 保留所有空串，limit=0(默认)丢弃尾部空串

// 5. 换行符分割
"line1\nline2\nline3".split("\\R");     // ["line1", "line2", "line3"] — \R 匹配各种换行
"line1\r\nline2\rline3".split("\\R");   // [\r\n, \r, \n 统一匹配]
"line1\nline2\nline3".split("\n");      // 简单场景直接用 \n

// 6. 制表符 / 特殊空白分割
"a\tb\tc".split("\t");              // ["a", "b", "c"]
"a  b    c".split("\\s+");          // ["a", "b", "c"] — 任意空白作分隔符

// 7. 字符串包含转义序列时的分割
// 注意：Java 字符串字面量中的 \n 是换行符(1个字符)，不是 \ 和 n
"\n".length()                       // 1，不是 2
"\\n".length()                      // 2，是 \ 和 n 两个字符
// 分割时注意区分：
"hello\nworld".split("\n");         // 按换行符分割 — ["hello", "world"]
"hello\\nworld".split("\\\\n");     // 按字面 \n 分割 — ["hello", "world"]

// 8. 用 StringTokenizer 替代 split（无需正则，性能更好）
import java.util.StringTokenizer;
StringTokenizer st = new StringTokenizer("a,b,c", ",");
while (st.hasMoreTokens()) {
    System.out.println(st.nextToken()); // a, b, c
}
// StringTokenizer 不用正则，对简单分隔符场景更高效

// 拼接
String.join("-", "a", "b", "c")  // "a-b-c"
String.join(",", list)            // List<String> 用逗号拼接

// 反转
new StringBuilder(s).reverse().toString()

// StringBuilder (笔试高频)
StringBuilder sb = new StringBuilder();
sb.append("hello");
sb.append(123);
sb.insert(0, "start:");
sb.delete(0, 6);          // 删除 [0, 6)
sb.reverse();
sb.charAt(0);
sb.setCharAt(0, 'H');
sb.toString();
```

### 数组与集合
```java
// 数组
int[] arr = {3, 1, 2};
Arrays.sort(arr);
Arrays.fill(arr, 0);              // 全填0
Arrays.equals(arr1, arr2);        // 比较内容
Arrays.toString(arr);             // "[3, 1, 2]"
Arrays.binarySearch(arr, 2);      // 需先排序，返回索引

// 创建定长数组
int[] arr = new int[10];          // 默认0
boolean[] visited = new boolean[10]; // 默认false
int[][] grid = new int[m][n];     // 二维

// List
List<Integer> list = new ArrayList<>();
list.add(1);
list.get(0);                     // 1
list.set(0, 10);                 // 修改
list.remove(0);                  // 按索引删
list.remove(Integer.valueOf(10)); // 按元素删
list.size();
list.isEmpty();
list.contains(10);
Collections.sort(list);
Collections.reverse(list);
Collections.max(list);
Collections.min(list);

// 数组 <-> List
int[] arr = {1, 2, 3};
// int[] -> List<Integer>
List<Integer> list = Arrays.stream(arr).boxed().collect(Collectors.toList());
// List<Integer> -> int[]
int[] arr2 = list.stream().mapToInt(i -> i).toArray();

// Map
Map<String, Integer> map = new HashMap<>();
map.put("a", 1);
map.get("a");            // 1
map.getOrDefault("b", 0); // 0
map.containsKey("a");    // true
map.remove("a");
map.size();
map.isEmpty();

// 遍历
for (var entry : map.entrySet()) {
    entry.getKey();
    entry.getValue();
}

// 计数 Map (笔试高频)
Map<Integer, Integer> count = new HashMap<>();
count.merge(key, 1, Integer::sum);        // key 不存在放1，存在则+1
count.put(key, count.getOrDefault(key, 0) + 1); // 同上

// Set
Set<Integer> set = new HashSet<>();
set.add(1);
set.contains(1);   // true
set.remove(1);
set.size();

// 队列
Queue<Integer> queue = new LinkedList<>();
queue.offer(1);    // 入队
queue.poll();      // 出队 (空返回null)
queue.peek();      // 查看队首

// 优先队列 (小顶堆)
PriorityQueue<Integer> minHeap = new PriorityQueue<>();
minHeap.offer(3);
minHeap.offer(1);
minHeap.poll();  // 1 (最小值)

// 大顶堆
PriorityQueue<Integer> maxHeap = new PriorityQueue<>(Collections.reverseOrder());

// 优先队列自定义排序
PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[0] - b[0]);

// 双端队列
Deque<Integer> deque = new ArrayDeque<>();
deque.offerFirst(1);   // 头部入
deque.offerLast(2);    // 尾部入
deque.pollFirst();     // 头部出
deque.pollLast();      // 尾部出
deque.peekFirst();     // 查看头部
deque.peekLast();      // 查看尾部

// 栈
Deque<Integer> stack = new ArrayDeque<>();
stack.push(1);    // 入栈
stack.pop();      // 出栈
stack.peek();     // 查看栈顶
```

---

## 笔试高频算法模板

### 输入输出模板 (笔试必备)
```java
import java.util.*;
import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        // 快速输入
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);

        // 读取单个数字
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;

        // 读取一行
        String line = br.readLine();
        String[] parts = line.split(" ");
        int[] arr = Arrays.stream(parts).mapToInt(Integer::parseInt).toArray();

        // 快速输出
        PrintWriter out = new PrintWriter(new BufferedOutputStream(System.out));
        out.println("result");
        out.flush(); // 最后一定要 flush

        // Scanner (简单但慢，数据量大时超时)
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        String s = sc.next();
    }
}
```

### 二分查找
```java
// 查找目标值
int binarySearch(int[] arr, int target) {
    int left = 0, right = arr.length - 1;
    while (left <= right) {
        int mid = left + (right - left) / 2; // 防溢出
        if (arr[mid] == target) return mid;
        else if (arr[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1;
}

// 查找左边界（第一个 >= target 的位置）
int lowerBound(int[] arr, int target) {
    int left = 0, right = arr.length;
    while (left < right) {
        int mid = left + (right - left) / 2;
        if (arr[mid] < target) left = mid + 1;
        else right = mid;
    }
    return left;
}

// 查找右边界（第一个 > target 的位置）
int upperBound(int[] arr, int target) {
    int left = 0, right = arr.length;
    while (left < right) {
        int mid = left + (right - left) / 2;
        if (arr[mid] <= target) left = mid + 1;
        else right = mid;
    }
    return left;
}
```

### 滑动窗口
```java
// 固定窗口大小
int slidingWindow(int[] arr, int k) {
    int sum = 0;
    for (int i = 0; i < k; i++) sum += arr[i];
    int maxSum = sum;
    for (int i = k; i < arr.length; i++) {
        sum += arr[i] - arr[i - k];
        maxSum = Math.max(maxSum, sum);
    }
    return maxSum;
}

// 可变窗口 — 最长子串不含重复字符
int lengthOfLongestSubstring(String s) {
    Map<Character, Integer> map = new HashMap<>();
    int left = 0, maxLen = 0;
    for (int right = 0; right < s.length(); right++) {
        char c = s.charAt(right);
        if (map.containsKey(c)) {
            left = Math.max(left, map.get(c) + 1);
        }
        map.put(c, right);
        maxLen = Math.max(maxLen, right - left + 1);
    }
    return maxLen;
}
```

### 双指针
```java
// 有序数组两数之和
int[] twoSum(int[] arr, int target) {
    int left = 0, right = arr.length - 1;
    while (left < right) {
        int sum = arr[left] + arr[right];
        if (sum == target) return new int[]{left, right};
        else if (sum < target) left++;
        else right--;
    }
    return new int[]{-1, -1};
}
```

### 前缀和
```java
// 一维前缀和
long[] prefix = new long[n + 1];
for (int i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i] + arr[i];
}
// 区间 [l, r] 的和 = prefix[r + 1] - prefix[l]

// 二维前缀和
long[][] prefix = new long[m + 1][n + 1];
for (int i = 0; i < m; i++) {
    for (int j = 0; j < n; j++) {
        prefix[i + 1][j + 1] = prefix[i][j + 1] + prefix[i + 1][j]
                             - prefix[i][j] + grid[i][j];
    }
}
// 子矩阵 (r1,c1) 到 (r2,c2) 的和
long sum = prefix[r2+1][c2+1] - prefix[r1][c2+1]
         - prefix[r2+1][c1] + prefix[r1][c1];
```

### DFS / BFS
```java
// DFS — 岛屿数量
void dfs(char[][] grid, int i, int j) {
    if (i < 0 || i >= grid.length || j < 0 || j >= grid[0].length
        || grid[i][j] == '0') return;
    grid[i][j] = '0';
    dfs(grid, i + 1, j);
    dfs(grid, i - 1, j);
    dfs(grid, i, j + 1);
    dfs(grid, i, j - 1);
}

// BFS
int[] dx = {1, -1, 0, 0};
int[] dy = {0, 0, 1, -1};

void bfs(char[][] grid, int si, int sj) {
    Queue<int[]> queue = new LinkedList<>();
    queue.offer(new int[]{si, sj});
    grid[si][sj] = '0';
    while (!queue.isEmpty()) {
        int[] cur = queue.poll();
        for (int d = 0; d < 4; d++) {
            int ni = cur[0] + dx[d], nj = cur[1] + dy[d];
            if (ni >= 0 && ni < grid.length && nj >= 0 && nj < grid[0].length
                && grid[ni][nj] == '1') {
                grid[ni][nj] = '0';
                queue.offer(new int[]{ni, nj});
            }
        }
    }
}
```

### 并查集
```java
class UnionFind {
    int[] parent, rank;
    int count; // 连通分量数

    UnionFind(int n) {
        parent = new int[n];
        rank = new int[n];
        count = n;
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    int find(int x) {
        if (parent[x] != x) parent[x] = find(parent[x]); // 路径压缩
        return parent[x];
    }

    boolean union(int x, int y) {
        int px = find(x), py = find(y);
        if (px == py) return false;
        if (rank[px] < rank[py]) parent[px] = py;
        else if (rank[px] > rank[py]) parent[py] = px;
        else { parent[py] = px; rank[px]++; }
        count--;
        return true;
    }
}
```

### 单调栈 / 单调队列
```java
// 单调栈 — 下一个更大元素
int[] nextGreater(int[] nums) {
    int n = nums.length;
    int[] res = new int[n];
    Arrays.fill(res, -1);
    Deque<Integer> stack = new ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        while (!stack.isEmpty() && nums[stack.peek()] < nums[i]) {
            res[stack.pop()] = nums[i];
        }
        stack.push(i);
    }
    return res;
}

// 单调队列 — 滑动窗口最大值
int[] maxSlidingWindow(int[] nums, int k) {
    int n = nums.length;
    int[] res = new int[n - k + 1];
    Deque<Integer> deque = new ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        while (!deque.isEmpty() && deque.peekFirst() <= i - k) deque.pollFirst();
        while (!deque.isEmpty() && nums[deque.peekLast()] <= nums[i]) deque.pollLast();
        deque.offerLast(i);
        if (i >= k - 1) res[i - k + 1] = nums[deque.peekFirst()];
    }
    return res;
}
```

---

*最后更新：2026-05-10*
