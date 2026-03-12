!macro customInit
  Push $0

  nsExec::ExecToStack 'cmd /C tasklist /FI "IMAGENAME eq EchoDraft.exe" | find /I "EchoDraft.exe" >nul'
  Pop $0
  StrCmp $0 "0" close_app
  Goto done

close_app:
  DetailPrint "Closing running EchoDraft instance"
  nsExec::ExecToLog 'taskkill /F /IM EchoDraft.exe /T'
  Sleep 1000
  nsExec::ExecToStack 'cmd /C tasklist /FI "IMAGENAME eq EchoDraft.exe" | find /I "EchoDraft.exe" >nul'
  Pop $0
  StrCmp $0 "0" 0 done

  MessageBox MB_ICONSTOP \
    "Setup could not close EchoDraft automatically. Please close it manually and run the installer again."
  Abort

done:
  Pop $0
!macroend

!macro customUnInstall
  StrCpy $0 "$PROFILE\.cache\echodraft\models"
  IfFileExists "$0\*.*" 0 +3
    RMDir /r "$0"
    DetailPrint "Removed EchoDraft cached models"
  StrCpy $1 "$PROFILE\.cache\echodraft"
  RMDir "$1"
!macroend
