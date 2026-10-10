# -*- coding: UTF-8 -*-
'''@author: weiyue.zhang
@project_name: UITest
@cur_file: base_config.py
@create_date: 2026/1/14
'''
import os

import yaml


class BaseSCConfig:
    """
    配置类-基础类 (后续通过继承此类适配不同项目)
    """
    _instance = None

    # 缓存配置数据
    _config_data = None
    _model_config_data = None

    # 记录配置文件的最后修改时间
    _config_mtime = 0
    _model_config_mtime = 0

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        # 初始化时不立即加载配置，使用懒加载
        current_path = os.path.dirname(os.path.abspath(__file__))
        self.ROOT_PATH = os.path.dirname(os.path.dirname(current_path))
        # 原来是 os.path.join(self.ROOT_PATH, r'config\config.yaml')：
        # 用字面量反斜杠拼路径，在 Windows 上能用，换到 Linux/macOS 会得到一个
        # 带字面量反斜杠的非法路径。改成逐段 join，让它跨平台成立。
        self.config_path = os.path.join(self.ROOT_PATH, 'config', 'config.yaml')
        self.config_example_path = os.path.join(self.ROOT_PATH, 'config', 'config.yaml.example')
        self.TEST_URL = None

    def _should_reload(self, file_path, current_mtime):
        """检查配置文件是否需要重新加载"""
        try:
            mtime = os.path.getmtime(file_path)
            return mtime > current_mtime
        except OSError:
            return False

    @property
    def _config(self):
        """懒加载主配置文件，支持热重载"""
        if (self._config_data is None or
                self._should_reload(self.config_path, self._config_mtime)):
            # 文件不存在时给出可操作的提示，而不是让 open() 抛一个只说路径的
            # FileNotFoundError —— 后来人不知道"该怎么把它建起来"。
            if not os.path.exists(self.config_path):
                raise FileNotFoundError(
                    f"配置文件不存在：{self.config_path}\n"
                    f"  做法：把 {self.config_example_path} 复制成 config/config.yaml 再修改。\n"
                    f"  （config/config.yaml 已在 .gitignore 中，不会被提交：配置常含敏感信息）"
                )
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self._config_data = yaml.safe_load(f)
            self._config_mtime = os.path.getmtime(self.config_path)
        return self._config_data
