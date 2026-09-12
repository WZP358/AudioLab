#!/bin/bash
bash /mnt/wzp/AudioLab/deploy/restore.sh
bash /mnt/wzp/AudioLab/deploy/switch_sslh.sh
nohup bash /mnt/wzp/AudioLab/deploy/autodeploy.sh > /dev/null 2>&1 &
