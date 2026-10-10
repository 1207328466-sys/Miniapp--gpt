# -*- coding: UTF-8 -*-
'''
@author: weiyue.zhang
@project_name: UITest
@cur_file: __init__.py.py
@create_date: 2025/12/22

【2026/10/10 修正】本文件原来 import 了 8 个**并不存在**的模块：
  sc_config / sc_log / sql_tools / test_common / test_decorator / web_decorator
后果是 `import common` 直接 ModuleNotFoundError —— 而且因为 Python 的包导入机制，
连 `from common.share import ...` 都会先执行本文件，于是整个 common 包都进不去。

这是一个典型的"看起来有、实际没有"：目录结构、README 都在描述这些能力，
但它们从来没有存在过。现在只导出**确实存在**的东西；缺失的那些属于"预留能力"
（数据库、通知、装饰器、全局初始化等），在真正实现并接入 JS 用例之前，
不再假装它们存在。

将来要恢复：实现对应模块后，逐行把 import 加回来即可。
'''

from .share import BaseSCConfig, BaseSCLog

__all__ = ["BaseSCConfig", "BaseSCLog"]
