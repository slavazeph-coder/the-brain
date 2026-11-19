# Line up your camera videos

Keep the cameras fixed and film the same moving subject from overlapping views. Include a distinct moment that is visible to every camera. Keep calibration images of the same camera setup, and clean background images if your masking method uses them.

1. In World Builder, open **Make it yours → Watch a moving scene → Line up my camera clips**. Add one video per camera. You can add videos from different folders. For larger rigs, use **Next cameras** to work through four views at a time.
2. In each video, pause on the same event and choose **Mark this moment**. Choose the output frame rate and how long to keep. The shortest available clip sets the end of the shared interval. Move the shared slider to check your marks.
3. Choose **Save camera setup**. Put the original clips in a directory such as `videos/`. If filenames repeat, use each camera's four-digit folder, for example `videos/0001/clip.mp4` and `videos/0002/clip.mp4`. The camera number follows the order shown in the playground.
4. With Python 3.9+ and FFmpeg installed, run this from the BrainSNN repository.

```sh
python3 scripts/world-open4dgs/extract_capture.py --setup camera-setup.json --videos videos --output-dir capture
```

The extractor checks each clip's name, byte length and SHA-256 of its first and last 64 KiB (counting overlapping bytes once). It writes `capture/images/0001/000001.jpg` and matching numbered views at a common constant frame rate. It publishes the directory only when every camera produces the requested frame count. Use a new output directory for a new extraction. The setup contains filenames and times. Your videos and images stay local.

These marks establish a visual starting point. Clock drift, rolling shutter and fractional-frame offsets can still affect reconstruction. Review camera registration and masks, then run the upstream timing solver on the prepared capture to refine the timing. [Continue to reconstruction](README.md)
