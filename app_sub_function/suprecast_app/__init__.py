# -*- coding: UTF-8 -*-
'''
@author: weiyue.zhang
@project_name: UITest
@cur_file: __init__.py.py
@create_date: 2025/12/22
'''
import os
import importlib

__all__ = []
cur_path = os.path.dirname(__file__)

for file in os.listdir(cur_path):
    if not file.startswith("_") and file.endswith(".py") and file != "__init__.py":
        mod_name = file[:-3]
        mod = importlib.import_module(f".{mod_name}", __name__)
        for attr in dir(mod):
            if not attr.startswith("_"):
                globals()[attr] = getattr(mod, attr)
                __all__.append(attr)
