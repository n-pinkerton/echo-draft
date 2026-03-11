!macro customUnInstall
  StrCpy $0 "$PROFILE\.cache\echodraft\models"
  IfFileExists "$0\*.*" 0 +3
    RMDir /r "$0"
    DetailPrint "Removed EchoDraft cached models"
  StrCpy $1 "$PROFILE\.cache\echodraft"
  RMDir "$1"
!macroend
