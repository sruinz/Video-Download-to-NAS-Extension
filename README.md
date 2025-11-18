# Video Download to NAS
[![엣지 스토어](https://img.shields.io/badge/엣지%20스토어-v1.1.16-0078D4?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+TWljcm9zb2Z0IEVkZ2U8L3RpdGxlPjxwYXRoIGZpbGw9IndoaXRlIiBkPSJNMTIuMzUyIDI0QzUuNTMgMjQgMCAxOC40NyAwIDExLjY0OCAwIDUuNTMgNS41MyAwIDEyLjM1NiAwYzUuNzI3IDAgOS41MDggMy4yMiAxMC40NSA3LjQyNGwtMy4zMzIgMS4yNThjLS44LTIuNjEtMi43My00LjUyNC02LjkyNC00LjUyNC00LjIyIDAtNy4zOSAzLjAxNS03LjM5IDcuNDkgMCA0LjQ1IDMuMTcgNy40OSA3LjM5IDcuNDkgNC4xOTQgMCA2LjEyNC0xLjkxNCA2LjkyNC00LjUyNGwzLjMzMiAxLjI1OEMyMS44NiAyMC43OCAxOC4wOCAyNCAxMi4zNTIgMjR6bS40MjItMTIuMjYySDUuMTk1djEuODE1aDcuNTh2LTEuODE1eiIvPjwvc3ZnPg==)](https://microsoftedge.microsoft.com/addons/detail/youtubedl-to-nas/idefjkbcbhgokgenjingeleopmficace?hl=ko)[![크롬 스토어](https://img.shields.io/chrome-web-store/v/fchehlladkkanoekpjffcfffpfbdaalj?label=%ED%81%AC%EB%A1%AC%20%EC%8A%A4%ED%86%A0%EC%96%B4&logo=google-chrome&logoColor=white&style=flat-square)](https://chromewebstore.google.com/detail/video-download-to-nas/fchehlladkkanoekpjffcfffpfbdaalj?hl=ko)

Video Download to nas 의 크롬 엣지 확장 프로그램입니다.

1.1.16 업데이트 내용:
VDtN 서버 토큰 인증 기능 추가

1.1.15 업데이트 내용:
자막 언어 선택 기능 추가

1.1.14 업데이트 내용:
자막(srt, vtt) 다운로드 기능 추가

1.1.13 업데이트 내용:
몇몇 코드 수정

1.1.12 업데이트 내용:
오버레이 창에 많은 목록이 표시될 때 스크롤 가능 하도록 수정

1.1.11 업데이트 내용:
오버레이 상의 blob영상 다운로드 방식 수정

1.1.1 업데이트 내용:
옵션 입력 편의성 수정

1.1.0 업데이트 내용 :
옵션UI 수정 및 브라우저 확장 프로그램 아이콘 클릭시 다운로드 가능 목록 표시 기능 추가

1.0.11 업데이트 내용 : 
이름과 아이콘 변경

1.0.1 업데이트 내용 : 
유튜브 동영상이 아닌 웹 브라우저 동영상에도 사용 가능

<img width="500" height="625" alt="스크린샷 2025-11-18 13 02 37" src="https://github.com/user-attachments/assets/b86836b1-126c-4619-98d9-b3c69c123427" />

![설명1](https://github.com/sruinz/youtube-dl-nas-extension/assets/63243848/1f459f0e-9a0c-4974-a59a-9a35bab3bed7)

![설명3](https://github.com/user-attachments/assets/2eace179-a4fa-4dc1-aca7-6da8c822a465)



시놀로지 나스 도커에서 실행 가능한 Video Download to nas 의 확장 프로그램 입니다.
(https://svrforum.com/nas/2866255)

영상 링크 우 클릭 또는 영상 텍스트 드래그 후 우 클릭시 
컨텍스트 메뉴가 표시됩니다.

해상도를 선택하면 Video Download to nas 설치 시 지정한 폴더로 mp4 파일이 저장 됩니다.

1080p 보다 큰 해상도의 영상은 av1 코덱으로 저장 되기 때문에 나스에서 재생 불가능 할 수 있습니다.


그리고 영상을 우클릭 후 컨텍스트 메뉴에서 옵션을 선택한 후 저장하는 기존 방식 외에 

브라우저의 확장 프로그램 아이콘을 클릭 했을 때 현재 페이지에서 나스로 다운로드 가능한 영상이 있을 경우

오버레이에 목록이 표시되고 클릭을 했을 때 저장이 되는 기능을 추가 했습니다


이 확장 프로그램을 사용하기 위해서는 https://svrforum.com/nas/2866255 서비스를 나스에 설치 해야 합니다

가이드 : https://svrforum.com/nas/1764971

설정에는 Video Download to nas 에서 설정한 아이디, 패스워드와 

Video Download to nas의 로웹페이지 주소를 rest api 부분에 입력해 준 후 저장 버튼을 눌러 저장합니다.

영상 링크 화면에서 우클릭 후 컨텍스트 메뉴에서 해상도를 선택 또는 오버레이에서 영상을 선택

그 후 나스의 폴더에 정상적으로 다운로드가 됐는지 확인 해보시고 

안된다면 아이디와 패스워드 혹은 접속 주소가 정상인지 확인 해보시기 바랍니다.
