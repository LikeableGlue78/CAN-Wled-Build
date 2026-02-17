# API Examples

Lite status
- GET /json/can

Full frames
- GET /json/can?full=1

Ping
- GET /json/can?ping=1

Example lite response
{
  "uptime": 12345,
  "nowMs": 12345,
  "canModFound": true,
  "usermodCount": 1,
  "can": {
    "enabled": true,
    "started": true,
    "bitrate": 500000,
    "listenOnly": true,
    "rxPin": 4,
    "txPin": 5,
    "rxQueueLen": 128,
    "filterEnabled": false,
    "filterExt": false,
    "filterId": 0,
    "filterMask": 2047,
    "rxCount": 100,
    "txCount": 0,
    "errors": 0,
    "overruns": 5,
    "lastFrameMs": 12000,
    "msSinceFrame": 20
  },
  "frames": []
}
