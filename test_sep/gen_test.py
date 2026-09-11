import numpy as np
import soundfile as sf
sr = 44100
duration = 10.0
t = np.linspace(0, duration, int(sr * duration), endpoint=False)
# 左右声道不同频率
left = 0.5 * np.sin(2 * np.pi * 440 * t)
right = 0.5 * np.sin(2 * np.pi * 554 * t)
audio = np.column_stack([left, right])
sf.write(r"D:\code\AudioLab\test_sep\test_input.wav", audio, sr)
print(f"生成了 {duration}秒 立体声 {sr}Hz 测试音频")
