# -*- coding: UTF-8 -*-
'''
@author: weiyue.zhang
@project_name: UITest
@cur_file: base_log.py
@create_date: 2026/1/14
'''
import logging
import logging.handlers
from datetime import datetime
from typing import Optional
from concurrent_log_handler import ConcurrentTimedRotatingFileHandler  # 新增

class BaseSCLog:
    """
    日志类-基础类 (后续通过继承此类适配不同项目)
    """
    _instance = None
    _initialized: bool = False

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, log_level: int = logging.DEBUG, log_file: Optional[str] = None):
        if BaseSCLog._initialized:
            return
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s'
        )
        self.ch = logging.StreamHandler()
        self.ch.setLevel(log_level)
        self.ch.setFormatter(formatter)
        # 整体日志
        self.log = logging.getLogger('sc_log')
        self.log.setLevel(log_level)
        self.log.propagate = False
        self.log.addHandler(self.ch)
        if log_file:
            fh = ConcurrentTimedRotatingFileHandler(
                log_file,
                when='D',
                interval=1,
                backupCount=30,
                encoding='utf-8',
                delay=True  # 关键：延迟加载，解决Windows文件锁
            )
            fh.setLevel(log_level)
            fh.setFormatter(formatter)
            self.log.addHandler(fh)
        self.log.info(f"日志服务初始化-{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

        BaseSCLog._initialized = True

    def get_logger(self) -> logging.Logger:
        """返回日志器实例，方便外部调用"""
        return self.log
