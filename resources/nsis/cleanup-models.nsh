!macro customInit
  Push $0
  Push $1

  nsExec::ExecToStack 'cmd /C tasklist /FI "IMAGENAME eq EchoDraft.exe" | find /I "EchoDraft.exe" >nul'
  Pop $0
  StrCmp $0 "0" check_running
  Goto done

check_running:
  MessageBox MB_ICONQUESTION|MB_YESNO \
    "EchoDraft is currently running. The installer needs to close it before continuing.$\r$\n$\r$\nClose EchoDraft now?" \
    IDYES close_app
  MessageBox MB_ICONSTOP \
    "Setup cannot continue while EchoDraft is running. Please close EchoDraft and run the installer again."
  Abort

close_app:
  nsExec::ExecToLog 'taskkill /IM EchoDraft.exe /T'
  StrCpy $1 8

wait_for_close:
  Sleep 500
  nsExec::ExecToStack 'cmd /C tasklist /FI "IMAGENAME eq EchoDraft.exe" | find /I "EchoDraft.exe" >nul'
  Pop $0
  StrCmp $0 "0" 0 done
  IntOp $1 $1 - 1
  IntCmp $1 0 still_running_after_close wait_for_close wait_for_close

still_running_after_close:
  MessageBox MB_ICONEXCLAMATION|MB_YESNO \
    "EchoDraft did not close in time. Force close it and continue?" \
    IDYES force_close
  MessageBox MB_ICONSTOP \
    "Setup cannot continue while EchoDraft is running. Please close EchoDraft and run the installer again."
  Abort

force_close:
  nsExec::ExecToLog 'taskkill /F /IM EchoDraft.exe /T'
  Sleep 1500

  nsExec::ExecToStack 'cmd /C tasklist /FI "IMAGENAME eq EchoDraft.exe" | find /I "EchoDraft.exe" >nul'
  Pop $0
  StrCmp $0 "0" 0 done

  MessageBox MB_ICONSTOP \
    "Setup could not close EchoDraft automatically. Please close it manually and run the installer again."
  Abort

done:
  Pop $1
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
