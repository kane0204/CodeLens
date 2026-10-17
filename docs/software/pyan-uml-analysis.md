# pyan 项目逆向工程分析（UML）

## 1. 核心时序图 (Sequence Diagram)
展示了 pyan 从读取源码到生成可视化图表的完整工作流程。

```mermaid
sequenceDiagram
    participant User as 用户
    participant CLI as 命令行接口
    participant Analyzer as 分析器
    participant AST as AST解析器
    participant GraphViz as 图形渲染引擎
    User->>CLI: 运行 pyan (输入源码路径)
    CLI->>Analyzer: 初始化分析任务
    Analyzer->>AST: 读取 .py 文件
    AST-->>Analyzer: 返回抽象语法树 (AST)
    loop 遍历作用域与节点
        Analyzer->>Analyzer: 提取类、函数、调用关系
        Analyzer->>Analyzer: 解析名称与继承关系
    end
    Analyzer-->>CLI: 返回调用关系图数据
    CLI->>GraphViz: 生成 DOT 格式文件
    GraphViz-->>User: 渲染输出图形 (SVG/HTML)
```

## 2. 核心类图 (Class Diagram)
展示了 pyan 内部的主要模块及其相互关系。

```mermaid
classDiagram
    class Pyan {
        +main()
        +parse_args()
        +run_analysis()
    }
    class Analyzer {
        +analyze(file_path)
        -_visit_node(node)
        -_resolve_name(name)
    }
    class Scope {
        +name: str
        +parent: Scope
        +add_definition()
        +find_definition()
    }
    class GraphBuilder {
        +add_node(node)
        +add_edge(source, target)
        +to_dot()
    }

    Pyan --> Analyzer : 使用
    Analyzer --> Scope : 维护
    Analyzer --> GraphBuilder : 构建关系
```
## 3. pyreverse 逆向工程实践记录

根据课程指导，我尝试使用 `pyreverse` 对本地 CodeLens 项目进行了逆向分析。

- **安装依赖**：`pip install pylint graphviz`
- **执行命令**：`pyreverse -o dot -p CodeLens .`
- **执行结果**：成功在根目录下生成了 `classes_CodeLens.dot` 文件。