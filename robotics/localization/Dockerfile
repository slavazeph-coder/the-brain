FROM ros:jazzy-ros-base
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends git python3-colcon-common-extensions python3-rosdep python3-pytest python3-numpy python3-pil python3-yaml ros-jazzy-rviz2 ros-jazzy-tf2-ros ros-jazzy-sensor-msgs-py ros-jazzy-rosbag2-storage-default-plugins && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/localizer/src
RUN git init lidar_localization_ros2 && cd lidar_localization_ros2 && git remote add origin https://github.com/rsasaki0109/lidar_localization_ros2.git && git fetch --depth 1 origin 6e21b7ed9e2e5c5ba1452eb63db5c9402862625b && git checkout --detach FETCH_HEAD && test "$(git rev-parse HEAD)" = 6e21b7ed9e2e5c5ba1452eb63db5c9402862625b
RUN git init ndt_omp_ros2 && cd ndt_omp_ros2 && git remote add origin https://github.com/rsasaki0109/ndt_omp_ros2.git && git fetch --depth 1 origin 17ce1e19831447a1f5bc5a68a4522fa8087f8933 && git checkout --detach FETCH_HEAD && test "$(git rev-parse HEAD)" = 17ce1e19831447a1f5bc5a68a4522fa8087f8933
WORKDIR /opt/localizer
RUN source /opt/ros/jazzy/setup.bash && apt-get update && rosdep update && rosdep install --from-paths src --ignore-src --rosdistro jazzy -y && colcon build --parallel-workers 2 --cmake-args -DCMAKE_BUILD_TYPE=Release && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY robotics/localization /app/robotics/localization
COPY tests/localization /app/tests/localization
ENV PYTHONPATH=/app
COPY robotics/localization/entrypoint.sh /localization-entrypoint.sh
RUN chmod 755 /localization-entrypoint.sh
ENTRYPOINT ["/localization-entrypoint.sh"]
CMD ["python3", "-m", "robotics.localization.ros2_runner", "--help"]
