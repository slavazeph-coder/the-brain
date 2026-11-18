#!/bin/bash
set -e
source /opt/ros/jazzy/setup.bash
source /opt/localizer/install/setup.bash
exec "$@"
