require('net').createServer().listen(Number(process.argv[2] || 47197), function () {
  console.log('UP ' + process.pid)
})
