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
        self.config_path = os.path.join(self.ROOT_PATH, r'config\config.yaml')
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
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self._config_data = yaml.safe_load(f)
            self._config_mtime = os.path.getmtime(self.config_path)
        return self._config_data
